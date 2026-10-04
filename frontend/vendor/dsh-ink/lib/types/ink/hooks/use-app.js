import { useContext } from 'react';
import AppContext from '../components/AppContext.js';
/**
 * Access this Ink app's output stream and manual exit handler.
 */
const useApp = () => useContext(AppContext);
export default useApp;
