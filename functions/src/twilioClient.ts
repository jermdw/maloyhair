import type twilioLib from 'twilio'

/**
 * `await import('twilio')` alone does not carry the package's static
 * properties (`validateRequest`, `twiml`) — only `.default` does, since
 * twilio's CJS entry point exports a callable function with those bolted on
 * rather than a plain object literal, and Node's ESM/CJS interop only
 * synthesizes `default`/`module.exports` on the namespace, not the
 * function's own properties. Centralized here so the import is written once
 * instead of re-inlined (and potentially regressed) at each call site — see
 * twilio-import.test.ts.
 */
export async function loadTwilio(): Promise<typeof twilioLib> {
  return (await import('twilio')).default
}

export async function createTwilioClient(accountSid: string, authToken: string) {
  const twilio = await loadTwilio()
  return twilio(accountSid, authToken)
}
