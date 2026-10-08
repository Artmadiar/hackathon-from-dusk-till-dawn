import { useEffect, useState } from 'react';

export interface Route {
  path: string;        // '#/task/t-123?x=1' -> 'task/t-123'
  parts: string[];     // ['task', 't-123']
  query: URLSearchParams;
}

function parse(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [path = '', q = ''] = raw.split('?');
  return { path, parts: path.split('/').filter(Boolean), query: new URLSearchParams(q) };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const onHash = (): void => setRoute(parse());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return route;
}

export function navigate(hash: string): void {
  window.location.hash = hash;
}
