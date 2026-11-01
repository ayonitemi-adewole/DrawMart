// POST from the store app: { action: 'banks' }, or { action: 'lookup' | 'save', bankCode, accountNumber }.
// The account name always comes from Flutterwave, on the server. Saving looks it up
// again rather than trusting what the browser was shown, so a store can't name its own
// account. Without a Flutterwave key, test mode uses a stand-in; real mode refuses.
import { corsHeaders, json, serviceClient } from '../_shared/deposits.ts'
import { banksOrFallback, COMMERCIAL_BANKS, FlutterwaveError, isTestKey, resolveAccount } from '../_shared/flutterwave.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const db = serviceClient()
  const token = req.headers.get('Authorization')?.replace(/^Bearer /, '') ?? ''
  const { data: auth } = await db.auth.getUser(token)
  if (!auth.user) return json({ error: 'Sign in first.' }, 401)
  const userId = auth.user.id

  const { action, bankCode, accountNumber } = (await req.json().catch(() => ({}))) as { action?: unknown; bankCode?: unknown; accountNumber?: unknown }

  const { data: settings, error: settingsError } = await db.from('app_settings').select('test_mode').single()
  if (settingsError) return json({ error: 'Couldn’t reach the database.' }, 502)
  const secretKey = Deno.env.get('FLW_SECRET_KEY') ?? ''
  const standIn = settings.test_mode && !secretKey
  if (!standIn && (!secretKey || settings.test_mode !== isTestKey(secretKey))) {
    console.error('bank-account: the Flutterwave key doesn’t match test mode, or is missing')
    return json({ error: 'Bank checks aren’t set up yet.' }, 503)
  }

  try {
    if (action === 'banks') return json({ banks: standIn ? COMMERCIAL_BANKS : await banksOrFallback(secretKey) })

    if (typeof bankCode !== 'string' || !/^[0-9A-Za-z]{2,10}$/.test(bankCode) || typeof accountNumber !== 'string' || !/^[0-9]{10}$/.test(accountNumber)) {
      return json({ error: 'Pick a bank and enter the 10-digit account number.' }, 400)
    }

    // Only sellers, and not too often: this tells whoever asks the name on any account.
    const { data: allowed, error: limitError } = await db.rpc('note_bank_lookup', { p_user: userId })
    if (limitError) throw limitError
    if (allowed === 'not_seller') return json({ error: 'Only sellers can add a bank account.' }, 403)
    if (allowed === 'too_many') return json({ error: 'Too many checks. Try again in an hour.' }, 429)

    const accountName = standIn ? `TEST ACCOUNT ${accountNumber.slice(-4)}` : await resolveAccount(bankCode, accountNumber, secretKey)
    if (!accountName) return json({ error: 'We couldn’t find that account. Check the bank and number.' }, 404)
    if (action === 'lookup') return json({ accountName })

    if (action === 'save') {
      const banks = standIn ? COMMERCIAL_BANKS : await banksOrFallback(secretKey)
      const bank = banks.find((b) => b.code === bankCode)
      if (!bank) return json({ error: 'Pick a bank from the list.' }, 400)
      const { error } = await db.rpc('save_payout_account', { p_user: userId, p_bank_code: bankCode, p_bank_name: bank.name, p_account_number: accountNumber, p_account_name: accountName })
      if (error) throw error
      return json({ accountName })
    }
    return json({ error: 'Unknown action.' }, 400)
  } catch (e) {
    console.error('bank-account', e)
    // Testers need the reason. Real sellers don't get Flutterwave's wording.
    if (settings.test_mode && e instanceof FlutterwaveError) return json({ error: `Flutterwave said: ${e.reason}` }, 502)
    return json({ error: 'We couldn’t reach the bank check. Try again in a moment.' }, 502)
  }
})
