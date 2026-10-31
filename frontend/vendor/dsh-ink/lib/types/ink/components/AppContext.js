import { createContext } from 'react';
/**
 * App-scoped services shared by the renderer and its descendants.
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
const AppContext = createContext({
    stdout: process.stdout,
    exit() { },
});
// eslint-disable-next-line custom-rules/no-top-level-side-effects
AppContext.displayName = 'InternalAppContext';
export default AppContext;
