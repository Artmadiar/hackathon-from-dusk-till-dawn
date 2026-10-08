import { cn } from '@/lib/utils';

export function Table({ className, ...props }: React.ComponentProps<'table'>) {
  return <table className={cn('w-full caption-bottom text-sm', className)} {...props} />;
}
export function TableHeader(props: React.ComponentProps<'thead'>) { return <thead {...props} />; }
export function TableBody(props: React.ComponentProps<'tbody'>) { return <tbody {...props} />; }
export function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return <tr className={cn('border-b last:border-0 transition-colors hover:bg-muted/40', className)} {...props} />;
}
export function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
  return <th className={cn('h-8 px-2 text-left align-middle text-xs font-medium text-muted-foreground', className)} {...props} />;
}
export function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return <td className={cn('px-2 py-1.5 align-middle', className)} {...props} />;
}
