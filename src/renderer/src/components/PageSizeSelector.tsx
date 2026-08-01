// shadcn Select wrapper for page-size selector (10/25/50/100).
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type Props = {
  value: number;
  onChange: (value: number) => void;
};

const PAGE_SIZES = [10, 25, 50, 100] as const;

export default function PageSizeSelector({ value, onChange }: Props): JSX.Element {
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger className="w-32" aria-label="Page size">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PAGE_SIZES.map((n) => (
          <SelectItem key={n} value={String(n)}>
            {n} / page
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
