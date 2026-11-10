import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import type { RealtimeChannel } from '@supabase/supabase-js'
import {
  addDays,
  budgetPeriod,
  computePocket,
  todayIn,
  type Period,
  type Pocket,
} from '@hml/shared'
import { supabase, type Tables } from '@/lib/supabase'
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
export type Member = Tables<'household_members'> & { profile: Tables<'profiles'> | null }

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
  const rules = ref<Rule[]>([])
  const accounts = ref<Account[]>([])
  const connections = ref<Connection[]>([])
  const transactions = shallowRef<Transaction[]>([])
  /** Days a budget month started because someone pressed "Payday" (salary early or late). */
  const paydays = ref<string[]>([])
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

  function period(offset = 0): Period {
    return budgetPeriod(today.value, household.value?.period_start_day ?? 1, offset, paydays.value)
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
    await loadPaydays()
    await Promise.all([
      loadMembers(),
      loadTable('categories'),
      loadTable('bills'),
      loadTable('incomes'),
      loadTable('goals'),
      loadTable('rules'),
      loadTable('accounts'),
      loadConnections(),
      loadTransactions(),
    ])
    startRealtime()
  }

  async function loadPaydays() {
    const rows = check(
      await supabase
        .from('paydays')
        .select('starts_on')
        .eq('household_id', household.value!.id)
        .order('starts_on'),
    )
    paydays.value = rows.map((r) => r.starts_on)
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
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'bank_connections', filter },
      () => scheduleReload('connections', loadConnections),
    )
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'transactions', filter },
      () => scheduleReload('transactions', () => loadTransactions(loadedFrom.value ?? undefined)),
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
    rules.value = []
    accounts.value = []
    connections.value = []
    transactions.value = []
    paydays.value = []
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
  ) {
    const { id, ...rest } = row as { id?: string } & Record<string, unknown>
    // One code path for five tables; each table's own types are checked at the call sites.
    const q = supabase.from(table as 'bills')
    if (id) {
      check(await q.update(rest as never).eq('id', id))
    } else {
      check(await q.insert({ ...rest, household_id: household.value!.id } as never))
    }
    await loadTable(table)
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
      Pick<Transaction, 'category_id' | 'bill_id' | 'income_id' | 'note' | 'ignored'>
    > & {
      manual?: boolean
    },
  ) {
    const updated = check(
      await supabase.from('transactions').update(patch).eq('id', id).select().single(),
    )
    transactions.value = transactions.value.map((t) => (t.id === id ? updated : t))
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
        manual: true,
      }),
    )
    await loadTransactions(loadedFrom.value ?? undefined)
  }

  async function deleteTransaction(id: string) {
    check(await supabase.from('transactions').delete().eq('id', id))
    transactions.value = transactions.value.filter((t) => t.id !== id)
  }

  /** Re-runs bills, incomes and rules over every transaction nobody edited by hand. */
  /** "Payday!": the new budget month starts on this day instead of the usual one. */
  async function markPayday(date: string) {
    check(
      await supabase
        .from('paydays')
        .upsert({ household_id: household.value!.id, starts_on: date }, { ignoreDuplicates: true }),
    )
    await loadPaydays()
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

  async function recategorize() {
    check(await supabase.rpc('recategorize', { p_household_id: household.value!.id }))
    await loadTransactions(loadedFrom.value ?? undefined)
  }

  return {
    household,
    members,
    categories,
    bills,
    incomes,
    goals,
    rules,
    accounts,
    connections,
    transactions,
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
    markPayday,
    unmarkPayday,
  }
})
