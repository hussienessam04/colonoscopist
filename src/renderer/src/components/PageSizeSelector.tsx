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
      <SelectTrigger
        className="w-32 bg-[#FBF7EE] border-[#E0D9C6] text-[#13202E] hover:border-[#A8C5B5] focus:border-[#0E3A47] focus:bg-white focus:ring-1 focus:ring-[#0E3A47]/30"
        aria-label="Page size"
      >
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
