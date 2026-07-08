import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createTwilioClient, loadTwilio } from './twilioClient.js'

/**
 * Regression coverage for twilioClient.ts's `(await import('twilio')).default`.
 *
 * Node's native ESM/CJS interop only synthesizes `default` (and
 * `module.exports`) on the namespace object for a CommonJS module — it does
 * not hoist the package's own properties as named exports, since `twilio`'s
 * CJS entry point exports a callable function with static properties bolted
 * on rather than a plain object literal. `await import('twilio')` (without
 * `.default`) therefore yields an object with neither `validateRequest` nor
 * `twiml`, which is exactly the bug that broke handleInboundSms in
 * production: it threw "twilio.validateRequest is not a function" at
 * runtime, only caught by hand-sending a signed webhook request to the
 * deployed function.
 *
 * index.ts (sendReminder, handleInboundSms) and messages.ts (sendMessage)
 * all go through loadTwilio()/createTwilioClient() rather than inlining the
 * import — this test calls those same shared helpers (via Node's real
 * module loader, not a bundler's transform: vitest's own SSR module runner
 * was tried here first and did NOT reproduce the bug), so a regression in
 * twilioClient.ts is caught by `npm test` instead of requiring a live
 * deploy + hand-signed curl request.
 */
describe('twilioClient', () => {
  it('loadTwilio() exposes validateRequest and twiml (handleInboundSms pattern)', async () => {
    const twilio = await loadTwilio()
    assert.equal(typeof twilio.validateRequest, 'function')
    assert.equal(typeof twilio.twiml.MessagingResponse, 'function')
  })

  it('constructs a working MessagingResponse (handleInboundSms pattern)', async () => {
    const twilio = await loadTwilio()

    const twiml = new twilio.twiml.MessagingResponse()
    twiml.message('Thank you for confirming your appointment. Reply STOP to opt out.')

    assert.match(twiml.toString(), /<Message>Thank you for confirming your appointment\. Reply STOP to opt out\.<\/Message>/)
  })

  it('validates a Twilio-signed request without throwing (handleInboundSms pattern)', async () => {
    const twilio = await loadTwilio()

    // Garbage signature/URL/params — only asserting the call resolves to a
    // boolean instead of throwing "not a function".
    const isValid = twilio.validateRequest('fake-auth-token', 'fake-signature', 'https://example.com/handleInboundSms', {})
    assert.equal(typeof isValid, 'boolean')
  })

  it('createTwilioClient() returns a REST client with callable messages.create (sendReminder/sendMessage pattern)', async () => {
    const client = await createTwilioClient('ACfakeaccountsid00000000000000000', 'fake-auth-token')

    assert.equal(typeof client.messages.create, 'function')
  })
})
