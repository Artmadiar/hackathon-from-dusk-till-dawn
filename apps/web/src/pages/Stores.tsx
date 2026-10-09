import { Loader2, Store } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, usd, type CatalogItem, type ProviderView } from '../api';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/** Витрина площадки: подключённые магазины и их живые каталоги.
 *  Покупает всё равно агент — страница отвечает на «из чего он вообще выбирает». */
export function StoresPage() {
  const [providers, setProviders] = useState<ProviderView[] | null>(null);
  const [catalogs, setCatalogs] = useState<Record<string, CatalogItem[] | 'error'>>({});

  useEffect(() => {
    void api<ProviderView[]>('GET', '/providers').then((list) => {
      setProviders(list);
      for (const p of list) {
        void api<{ items: CatalogItem[] }>('GET', `/providers/${p.id}/catalog`)
          .then((r) => setCatalogs((prev) => ({ ...prev, [p.id]: r.items })))
          .catch(() => setCatalogs((prev) => ({ ...prev, [p.id]: 'error' })));
      }
    }).catch(() => setProviders([]));
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Connected stores</h1>
        <p className="text-sm text-muted-foreground">
          Live catalogs, straight from each store&apos;s agent. Your agent requests quotes from every
          matching store and picks the best offer — you never browse, but here is what it chooses from.
        </p>
      </div>

      {!providers && (
        <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading the registry…
        </p>
      )}
      {providers?.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">No stores in the registry yet.</p>
      )}

      <div className="grid items-start gap-4 md:grid-cols-2">
        {providers?.map((p) => {
          const cat = catalogs[p.id];
          return (
            <Card key={p.id} className={p.active ? '' : 'opacity-60'}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Store className="size-4 text-primary" /> {p.name}
                  {!p.active && <Badge variant="secondary">inactive</Badge>}
                </CardTitle>
                <CardDescription>
                  rating <Badge variant={p.rating >= 4 ? 'success' : 'warning'}>{p.rating.toFixed(2)}</Badge>
                  {' · '}{p.categories.join(', ')}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-1.5">
                {cat === undefined && (
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" /> Asking the store&apos;s agent…
                  </p>
                )}
                {cat === 'error' && (
                  <p className="text-xs text-muted-foreground">Store agent is not responding right now.</p>
                )}
                {Array.isArray(cat) && cat.map((it) => (
                  <div key={it.sku} className="flex items-baseline gap-2 rounded-lg border px-2.5 py-1.5 text-xs">
                    <span className="min-w-0 flex-1 truncate font-medium" title={it.description}>{it.title}</span>
                    {it.category && <Badge variant="secondary">{it.category}</Badge>}
                    <span className="shrink-0 font-semibold tabular-nums">
                      {usd(it.price)}<span className="font-normal text-muted-foreground"> / {it.unit}</span>
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
