/**
 * Pestañas de la aplicación. Vive aquí porque la unión estaba duplicada
 * literalmente en `page.tsx` y en `NavbarProps`, y añadir una pestaña obligaba
 * a acordarse de las dos.
 */
export type AppTab = 'agents' | 'workbench' | 'workflows' | 'live' | 'history';
