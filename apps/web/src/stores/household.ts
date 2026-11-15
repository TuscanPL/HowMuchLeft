import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import type { RealtimeChannel } from '@supabase/supabase-js'
import {
  addDays,
  budgetPeriod,
  computePocket,
  eventCandidates,
  eventSpan,
  eventTotal,
  type EventTotal,
  todayIn,
  type PaydayPlan,
  type Period,
  type Pocket,
  type SyncSummary,
} from '@hml/shared'
import { supabase, type Tables } from '@/lib/supabase'
import { bankApi } from '@/lib/bank'
import { useAuthStore } from './auth'

export type Household = Tables<'households'>
export type Category = Tables<'categories'>
export type Bill = Tables<'bills'>
export type Income = Tables<'incomes'>
export type Goal = Tables<'goals'>
export type Rule = Tables<'rules'>
export type Account = Tables<'accounts'>
export type Transaction = Tables<'transactions'>
export type Connection = Tables<'bank_connections'>
export type HmlEvent = Tables<'events'>
export type Member = Tables<'household_members'> & { profile: Tables<'profiles'> | null }

/** Opening the app syncs the banks when they were last read longer ago than this. */
const AUTO_SYNC_AFTER_MS = 60 * 60_000
const AUTO_SYNC_RETRY_MS = 10 * 60_000

/** How many budget months of transactions to keep loaded (the current one and before). */
const MONTHS_LOADED = 3

function check<T>(r: { data: T; error: { message: string } | null }): NonNullable<T> {
  if (r.error) throw new Error(r.error.message)
  return r.data as NonNullable<T>
}

/**
 * The signed-in person's household and everything in it. Both partners see the
 * same data; realtime keeps it current when the other one changes something.
 */
export const useHouseholdStore = defineStore('household', () => {
  const household = ref<Household | null>(null)
  const members = ref<Member[]>([])
  const categories = ref<Category[]>([])
  const bills = ref<Bill[]>([])
  const incomes = ref<Income[]>([])
  const goals = ref<Goal[]>([])
  /** What the partner's secret goals set aside each month (one total, no details). */
  const privateGoalsMonthly = ref(0)
  const rules = ref<Rule[]>([])
  const accounts = ref<Account[]>([])
  const connections = ref<Connection[]>([])
  const transactions = shallowRef<Transaction[]>([])
  /** Events, newest first. */
  const events = ref<HmlEvent[]>([])
  /** Every tagged transaction's amount, for event totals (events can be older than what's loaded). */
  const eventAmountRows = shallowRef<{ event_id: string; amount: number }[]>([])
  /** Days a budget month started because someone pressed "Payday" (salary early or late). */
  const paydayRows = ref<{ starts_on: string; created_by: string | null }[]>([])
  const paydays = computed(() => paydayRows.value.map((p) => p.starts_on))
  const loadedFrom = ref<string | null>(null)
  const today = ref(todayIn())
  let loading: Promise<void> | null = null
  let channel: RealtimeChannel | null = null
  let loadedFor: string | null = null

  const currency = computed(() => household.value?.currency ?? 'PLN')
  const categoryById = computed(() => new Map(categories.value.map((c) => [c.id, c])))
  const accountById = computed(() => new Map(accounts.value.map((a) => [a.id, a])))
  const billById = computed(() => new Map(bills.value.map((b) => [b.id, b])))
  const incomeById = computed(() => new Map(incomes.value.map((i) => [i.id, i])))

  /** Salaries that arrived (transactions matched to an income), for working out where months start. */
  const arrivalRows = ref<{ booked_on: string; income_id: string }[]>([])

  /** What decides where budget months start: salary days, salary arrivals, pressed paydays. */
  const plan = computed<PaydayPlan>(() => {
    const salaries = incomes.value.filter((i) => i.active && i.starts_month)
    const payDayOf = new Map(salaries.map((i) => [i.id, i.pay_day]))
    return {
      startDay: household.value?.period_start_day ?? 1,
      payDays: salaries.map((i) => i.pay_day),
      arrivals: arrivalRows.value
        .filter((a) => payDayOf.has(a.income_id))
        .map((a) => ({ date: a.booked_on, payDay: payDayOf.get(a.income_id)! })),
      paydays: paydays.value,
    }
  })

  function period(offset = 0): Period {
    return budgetPeriod(today.value, plan.value, offset)
  }

  /** Why a budget month starts when it does: a salary arriving, a pressed payday, or the calendar. */
  function startReason(
    p: Period,
  ): { kind: 'salary'; income: string } | { kind: 'payday'; by: string | null } | null {
    if (!p.arrived) return null
    if (paydays.value.includes(p.start)) return { kind: 'payday', by: paydayBy(p.start) }
    const a = arrivalRows.value.find(
      (r) => r.booked_on === p.start && incomeById.value.has(r.income_id),
    )
    return a ? { kind: 'salary', income: incomeById.value.get(a.income_id)!.name } : null
  }

  function pocketFor(offset = 0): Pocket {
    const p = period(offset)
    const pocketAccounts = new Set(
      accounts.value.filter((a) => a.include_in_pocket).map((a) => a.id),
    )
    return computePocket({
      // A past month is seen from its last day.
      today: offset < 0 ? p.end : today.value,
      period: p,
      transactions: transactions.value,
      categories: categories.value,
      bills: bills.value,
      incomes: incomes.value,
      goals: goals.value,
      privateGoals: privateGoalsMonthly.value,
      pocketAccountIds: pocketAccounts,
    })
  }

  const pocket = computed(() => pocketFor(0))

  /** Loads the household once per signed-in user; later calls reuse it. */
  function ensureLoaded(): Promise<void> {
    const auth = useAuthStore()
    if (loadedFor !== auth.userId) {
      loadedFor = auth.userId
      loading = load()
    }
    return loading ?? Promise.resolve()
  }

  async function load() {
    today.value = todayIn()
    const auth = useAuthStore()
    const { data: membership } = await supabase
      .from('household_members')
      .select('household_id')
      .eq('user_id', auth.userId!)
      .order('joined_at')
      .limit(1)
      .maybeSingle()
    household.value = membership
      ? ((await supabase.from('households').select('*').eq('id', membership.household_id).single())
          .data ?? null)
      : null
    if (!household.value) {
      stopRealtime()
      return
    }
    // Paydays first: they decide which months of transactions to load.
    await Promise.all([loadPaydays(), loadTable('incomes'), loadArrivals()])
    await Promise.all([
      loadMembers(),
      loadTable('categories'),
      loadTable('bills'),
      loadTable('goals'),
      loadTable('rules'),
      loadTable('accounts'),
      loadConnections(),
      loadTransactions(),
      loadEvents(),
    ])
    startRealtime()
  }

  async function loadArrivals() {
    const rows = check(
      await supabase
        .from('transactions')
        .select('booked_on, income_id')
        .eq('household_id', household.value!.id)
        .not('income_id', 'is', null)
        .eq('ignored', false)
        .gt('amount', 0)
        .gte('booked_on', addDays(today.value, -450))
        .order('booked_on'),
    )
    arrivalRows.value = rows as { booked_on: string; income_id: string }[]
  }

  async function loadPaydays() {
    const rows = check(
      await supabase
        .from('paydays')
        .select('starts_on, created_by')
        .eq('household_id', household.value!.id)
        .order('starts_on'),
    )
    paydayRows.value = rows
  }

  async function loadMembers() {
    const id = household.value!.id
    const rows = check(
      await supabase
        .from('household_members')
        .select('*')
        .eq('household_id', id)
        .order('joined_at'),
    )
    // profiles_select lets us read everyone we share a household with.
    const profiles = check(
      await supabase
        .from('profiles')
        .select('*')
        .in(
          'id',
          rows.map((r) => r.user_id),
        ),
    )
    members.value = rows.map((r) => ({
      ...r,
      profile: profiles.find((p) => p.id === r.user_id) ?? null,
    }))
  }

  async function loadEvents() {
    const id = household.value!.id
    const [rows, amounts] = await Promise.all([
      supabase
        .from('events')
        .select('*')
        .eq('household_id', id)
        .order('started_at', { ascending: false }),
      supabase
        .from('transactions')
        .select('event_id, amount')
        .eq('household_id', id)
        .not('event_id', 'is', null),
    ])
    events.value = check(rows)
    eventAmountRows.value = check(amounts) as { event_id: string; amount: number }[]
  }

  const eventTotals = computed(() => {
    const amounts = new Map<string, number[]>()
    for (const r of eventAmountRows.value) {
      const list = amounts.get(r.event_id) ?? []
      list.push(r.amount)
      amounts.set(r.event_id, list)
    }
    return new Map<string, EventTotal>(
      events.value.map((e) => [e.id, eventTotal(amounts.get(e.id) ?? [], e.budget)]),
    )
  })

  /** The event I'm checked in to, if any. */
  const myOpenEvent = computed(() => {
    const auth = useAuthStore()
    return (
      events.value.find((e) => e.created_by === auth.userId && eventSpan(e, today.value).open) ??
      null
    )
  })

  type SimpleTable = 'categories' | 'bills' | 'incomes' | 'goals' | 'rules' | 'accounts'
  const targets = { categories, bills, incomes, goals, rules, accounts } as const
  const orderBy: Record<SimpleTable, string> = {
    categories: 'position',
    bills: 'due_day',
    incomes: 'pay_day',
    goals: 'created_at',
    rules: 'match',
    accounts: 'created_at',
  }

  async function loadTable(table: SimpleTable) {
    const rows = check(
      await supabase
        .from(table)
        .select('*')
        .eq('household_id', household.value!.id)
        .order(orderBy[table]),
    )
    ;(targets[table] as { value: unknown }).value = rows
    if (table === 'goals') await loadPrivateGoals()
  }

  /**
   * The partner's secret goals, as one monthly total. Realtime doesn't tell us
   * about rows we can't see, so this is also re-read when the app comes back.
   */
  async function loadPrivateGoals() {
    if (!household.value) return
    privateGoalsMonthly.value = Number(
      check(await supabase.rpc('private_goals_monthly', { p_household_id: household.value.id })) ??
        0,
    )
  }

  async function loadConnections() {
    const rows = check(
      await supabase
        .from('bank_connections')
        .select('*')
        .eq('household_id', household.value!.id)
        .order('created_at'),
    )
    connections.value = rows
  }

  /** Transactions for the last few budget months (more on request). */
  async function loadTransactions(from?: string) {
    const since = from ?? period(-(MONTHS_LOADED - 1)).start
    const all: Transaction[] = []
    // PostgREST caps a response at 1000 rows; page through.
    for (let offset = 0; ; offset += 1000) {
      const rows = check(
        await supabase
          .from('transactions')
          .select('*')
          .eq('household_id', household.value!.id)
          .gte('booked_on', since)
          .order('booked_on', { ascending: false })
          .order('created_at', { ascending: false })
          .range(offset, offset + 999),
      )
      all.push(...rows)
      if (rows.length < 1000) break
    }
    transactions.value = all
    loadedFrom.value = since
  }

  async function loadOlder() {
    if (!loadedFrom.value) return
    await loadTransactions(addDays(loadedFrom.value, -31))
  }

  let reloadTimers: Record<string, ReturnType<typeof setTimeout>> = {}
  function scheduleReload(key: string, fn: () => Promise<void>) {
    clearTimeout(reloadTimers[key])
    reloadTimers[key] = setTimeout(() => void fn().catch(() => {}), 400)
  }

  function startRealtime() {
    stopRealtime()
    const id = household.value!.id
    channel = supabase.channel(`household:${id}`)
    const filter = `household_id=eq.${id}`
    for (const table of ['categories', 'bills', 'incomes', 'goals', 'accounts'] as const) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table, filter }, () =>
        scheduleReload(table, () => loadTable(table)),
      )
    }
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'paydays', filter }, () =>
      scheduleReload('paydays', loadPaydays),
    )
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'events', filter }, () =>
      scheduleReload('events', loadEvents),
    )
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'bank_connections', filter },
      () => scheduleReload('connections', loadConnections),
    )
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'transactions', filter },
      () =>
        scheduleReload('transactions', async () => {
          await loadArrivals()
          await loadTransactions(loadedFrom.value ?? undefined)
          await loadEvents()
        }),
    )
    channel.subscribe()
  }

  function stopRealtime() {
    if (channel) void supabase.removeChannel(channel)
    channel = null
    for (const t of Object.values(reloadTimers)) clearTimeout(t)
    reloadTimers = {}
  }

  function reset() {
    stopRealtime()
    loadedFor = null
    loading = null
    household.value = null
    members.value = []
    categories.value = []
    bills.value = []
    incomes.value = []
    goals.value = []
    privateGoalsMonthly.value = 0
    rules.value = []
    accounts.value = []
    connections.value = []
    transactions.value = []
    events.value = []
    eventAmountRows.value = []
    paydayRows.value = []
    arrivalRows.value = []
  }

  async function reload() {
    loadedFor = null
    await ensureLoaded()
  }

  // ---- writes -------------------------------------------------------------

  async function createHousehold(name: string, periodStartDay: number) {
    check(
      await supabase.rpc('create_household', {
        p_name: name,
        p_period_start_day: periodStartDay,
      }),
    )
    await reload()
  }

  async function updateHousehold(patch: Partial<Pick<Household, 'name' | 'period_start_day'>>) {
    household.value = check(
      await supabase
        .from('households')
        .update(patch)
        .eq('id', household.value!.id)
        .select()
        .single(),
    )
  }

  /** Inserts or updates a row of a budget table, then refreshes it. */
  async function save<T extends 'categories' | 'bills' | 'incomes' | 'goals' | 'rules'>(
    table: T,
    row: Partial<Tables<T>> & { id?: string },
  ): Promise<Tables<T>> {
    const { id, ...rest } = row as { id?: string } & Record<string, unknown>
    // One code path for five tables; each table's own types are checked at the call sites.
    const q = supabase.from(table as 'bills')
    const saved = id
      ? check(
          await q
            .update(rest as never)
            .eq('id', id)
            .select()
            .single(),
        )
      : check(
          await q
            .insert({ ...rest, household_id: household.value!.id } as never)
            .select()
            .single(),
        )
    await loadTable(table)
    return saved as unknown as Tables<T>
  }

  async function remove(
    table: 'categories' | 'bills' | 'incomes' | 'goals' | 'rules' | 'accounts',
    id: string,
  ) {
    check(
      await supabase
        .from(table as 'bills')
        .delete()
        .eq('id', id),
    )
    await loadTable(table)
  }

  async function updateAccount(
    id: string,
    patch: Partial<Pick<Account, 'name' | 'include_in_pocket' | 'owner_id' | 'balance'>>,
  ) {
    check(await supabase.from('accounts').update(patch).eq('id', id))
    await loadTable('accounts')
  }

  async function updateTransaction(
    id: string,
    patch: Partial<
      Pick<Transaction, 'category_id' | 'bill_id' | 'income_id' | 'note' | 'ignored' | 'event_id'>
    > & {
      manual?: boolean
    },
  ) {
    const updated = check(
      await supabase.from('transactions').update(patch).eq('id', id).select().single(),
    )
    transactions.value = transactions.value.map((t) => (t.id === id ? updated : t))
    // Marking a payment as a salary (or not) can move where the month starts.
    if ('income_id' in patch || 'ignored' in patch) await loadArrivals()
    if ('event_id' in patch) await loadEvents()
  }

  /** A manual account for cash (or a bank we don't sync), created on first use. */
  async function cashAccount(): Promise<Account> {
    const existing = accounts.value.find((a) => !a.external_uid && a.name === 'Cash')
    if (existing) return existing
    const auth = useAuthStore()
    const row = check(
      await supabase
        .from('accounts')
        .insert({
          household_id: household.value!.id,
          name: 'Cash',
          currency: currency.value,
          owner_id: auth.userId,
        })
        .select()
        .single(),
    )
    await loadTable('accounts')
    return row
  }

  async function addManualTransaction(input: {
    accountId: string
    bookedOn: string
    amount: number
    description: string
    categoryId: string | null
    eventId?: string | null
  }) {
    check(
      await supabase.from('transactions').insert({
        household_id: household.value!.id,
        account_id: input.accountId,
        external_id: `m:${crypto.randomUUID()}`,
        booked_on: input.bookedOn,
        amount: input.amount,
        currency: currency.value,
        description: input.description,
        category_id: input.categoryId,
        event_id: input.eventId ?? null,
        manual: true,
      }),
    )
    await loadTransactions(loadedFrom.value ?? undefined)
    if (input.eventId) await loadEvents()
  }

  async function deleteTransaction(id: string) {
    check(await supabase.from('transactions').delete().eq('id', id))
    transactions.value = transactions.value.filter((t) => t.id !== id)
    await loadArrivals()
  }

  /** Re-runs bills, incomes and rules over every transaction nobody edited by hand. */
  /**
   * "Payday!": the new budget month starts on this day instead of the usual one.
   * If a payday is already marked for this month (the other person pressed it),
   * nothing changes unless `move` is set; the result says which day stands.
   */
  async function markPayday(date: string, move = false) {
    const rows = check(
      await supabase.rpc('mark_payday', {
        p_household_id: household.value!.id,
        p_date: date,
        p_move: move,
      }),
    )
    await loadPaydays()
    return rows[0]!
  }

  /** Who pressed the payday that started this day's month. */
  function paydayBy(date: string): string | null {
    const row = paydayRows.value.find((p) => p.starts_on === date)
    return members.value.find((m) => m.user_id === row?.created_by)?.profile?.display_name ?? null
  }

  async function unmarkPayday(date: string) {
    check(
      await supabase
        .from('paydays')
        .delete()
        .eq('household_id', household.value!.id)
        .eq('starts_on', date),
    )
    await loadPaydays()
  }

  // ---- events -------------------------------------------------------------

  /** Check in: starts an event now (and closes the one I was still checked in to). */
  async function checkIn(input: { name: string; emoji: string; budget: number | null }) {
    const row = check(
      await supabase.rpc('event_check_in', {
        p_household_id: household.value!.id,
        p_name: input.name,
        p_emoji: input.emoji,
        ...(input.budget === null ? {} : { p_budget: input.budget }),
      }),
    )
    await loadEvents()
    return row
  }

  async function updateEvent(
    id: string,
    patch: Partial<Pick<HmlEvent, 'name' | 'emoji' | 'budget' | 'started_at' | 'ended_at'>>,
  ) {
    check(await supabase.from('events').update(patch).eq('id', id))
    await loadEvents()
  }

  function checkOut(id: string) {
    return updateEvent(id, { ended_at: new Date().toISOString() })
  }

  /** Deletes the event; its transactions stay, untagged. */
  async function deleteEvent(id: string) {
    check(await supabase.from('events').delete().eq('id', id))
    transactions.value = transactions.value.map((t) =>
      t.event_id === id ? { ...t, event_id: null } : t,
    )
    await loadEvents()
  }

  /** Adds transactions to an event (or takes them out with null). Categories stay as they are. */
  async function setEvent(ids: string[], eventId: string | null) {
    if (!ids.length) return
    const rows = check(
      await supabase.from('transactions').update({ event_id: eventId }).in('id', ids).select(),
    )
    const byId = new Map(rows.map((r) => [r.id, r]))
    transactions.value = transactions.value.map((t) => byId.get(t.id) ?? t)
    await loadEvents()
  }

  /** What's in an event, read from the database (it may be older than what's loaded). */
  async function eventTransactions(eventId: string): Promise<Transaction[]> {
    return check(
      await supabase
        .from('transactions')
        .select('*')
        .eq('event_id', eventId)
        .order('booked_on', { ascending: false })
        .order('created_at', { ascending: false }),
    )
  }

  /** Charges worth adding: the checked-in person's, from the event's days, not in an event yet. */
  async function eventSuggestions(event: HmlEvent): Promise<Transaction[]> {
    const { from, to } = eventSpan(event, today.value)
    const mine = accounts.value.filter((a) => a.owner_id === event.created_by).map((a) => a.id)
    if (!mine.length) return []
    const rows = check(
      await supabase
        .from('transactions')
        .select('*')
        .in('account_id', mine)
        .is('event_id', null)
        .gte('booked_on', from)
        .lte('booked_on', to)
        .order('booked_on', { ascending: false })
        .order('created_at', { ascending: false }),
    )
    return eventCandidates(event, rows, accounts.value, today.value)
  }

  // ---- bank sync ----------------------------------------------------------

  /** A sync is running (from "Sync now" or on opening the app). */
  const bankSyncing = ref(false)
  let syncing: Promise<SyncSummary> | null = null
  let lastAutoAttempt = 0

  /** Pulls fresh balances and transactions from the banks, then reloads. */
  function syncBanks(): Promise<SyncSummary> {
    syncing ??= (async () => {
      bankSyncing.value = true
      try {
        const summary = await bankApi.sync(household.value!.id)
        await Promise.all([loadConnections(), loadTable('accounts'), loadArrivals()])
        await Promise.all([loadTransactions(loadedFrom.value ?? undefined), loadEvents()])
        return summary
      } finally {
        bankSyncing.value = false
        syncing = null
      }
    })()
    return syncing
  }

  /**
   * Opening the app (or coming back to it) syncs if the banks haven't been read
   * for an hour. A person is present, so this doesn't use up the 4 reads a day
   * banks allow without you. A failed try waits 10 minutes before the next.
   */
  async function autoSync() {
    if (!household.value || syncing || !navigator.onLine) return
    if (Date.now() - lastAutoAttempt < AUTO_SYNC_RETRY_MS) return
    const stale = connections.value.some(
      (c) =>
        (c.status === 'active' || c.status === 'error') &&
        (!c.last_synced_at || Date.now() - Date.parse(c.last_synced_at) > AUTO_SYNC_AFTER_MS),
    )
    if (!stale) return
    lastAutoAttempt = Date.now()
    // Problems show on the connection itself (status and last error); nothing to report here.
    await syncBanks().catch(() => {})
  }

  async function recategorize() {
    check(await supabase.rpc('recategorize', { p_household_id: household.value!.id }))
    await loadArrivals()
    await loadTransactions(loadedFrom.value ?? undefined)
  }

  return {
    household,
    members,
    categories,
    bills,
    incomes,
    goals,
    privateGoalsMonthly,
    loadPrivateGoals,
    rules,
    accounts,
    connections,
    transactions,
    events,
    eventTotals,
    myOpenEvent,
    checkIn,
    checkOut,
    updateEvent,
    deleteEvent,
    setEvent,
    eventTransactions,
    eventSuggestions,
    loadEvents,
    loadedFrom,
    today,
    currency,
    categoryById,
    accountById,
    billById,
    incomeById,
    pocket,
    period,
    pocketFor,
    ensureLoaded,
    reload,
    reset,
    loadConnections,
    loadTable,
    loadTransactions,
    loadOlder,
    createHousehold,
    updateHousehold,
    save,
    remove,
    updateAccount,
    updateTransaction,
    cashAccount,
    addManualTransaction,
    deleteTransaction,
    recategorize,
    paydays,
    bankSyncing,
    syncBanks,
    autoSync,
    plan,
    startReason,
    loadArrivals,
    markPayday,
    paydayBy,
    unmarkPayday,
  }
})
