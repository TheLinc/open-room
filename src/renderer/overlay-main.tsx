import { createRoot } from 'react-dom/client'
import App from '../overlay/App'
import '../overlay/overlay.css'

/**
 * The overlay's entry point.
 *
 * It lives here rather than in `src/overlay/` because Vite resolves a script
 * `src` in HTML against the renderer root, so `../overlay/main.tsx` flattens
 * to a path that does not exist and only fails in dev. Module imports go
 * through the resolver and can cross the root boundary, so this two-line
 * bootstrap is inside the root and every overlay component stays outside it.
 */
createRoot(document.getElementById('root') as HTMLElement).render(<App />)
