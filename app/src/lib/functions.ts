import { connectFunctionsEmulator, getFunctions } from 'firebase/functions'
import { app } from '@/lib/firebase'

export const functions = getFunctions(app, 'us-east1')

if (import.meta.env.DEV) {
  connectFunctionsEmulator(functions, '127.0.0.1', 5001)
}
