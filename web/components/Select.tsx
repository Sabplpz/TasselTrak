import Image from "next/image";

// Figma "Select" control. The visible box shows `label` (e.g. "Major: All") and hugs it; a native
// select sits invisibly on top, so the menu, keyboard and screen-reader behaviour stay native.
export function Select({ label, children, ...props }: React.ComponentProps<"select"> & { label: string }) {
  return (
    <span className="relative inline-flex max-w-full flex-none items-center gap-1 rounded-[10px] border-[1.5px] border-ink-primary bg-surface-card py-1.5 pl-3 pr-2 has-focus-visible:ring-4 has-focus-visible:ring-brand-gold/25">
      <span className="truncate text-label-14 text-ink-primary">{label}</span>
      <Image src="/advisor/chevron-down.svg" alt="" width={16} height={16} className="flex-none" />
      <select {...props} className="absolute inset-0 size-full cursor-pointer appearance-none opacity-0">
        {children}
      </select>
    </span>
  );
}
