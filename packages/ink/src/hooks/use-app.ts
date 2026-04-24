import { useContext } from 'react'
import AppContext from '../components/AppContext.js'

/**
 * `useApp` is a React hook, which exposes methods to manually exit the app,
 * query terminal colors, and control low-level renderer state.
 */
const useApp = () => useContext(AppContext)
export default useApp
