import { createContext, useContext } from 'react';
export const previewEnabled = import.meta.env.DEV || import.meta.env.VITE_HOSTED_PREVIEW === 'true';
export const PreviewMode = createContext(false);
export function usePageThrough() { const enabled = useContext(PreviewMode); return enabled; }
