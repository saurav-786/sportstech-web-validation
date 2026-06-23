export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <svg width="25" height="29" viewBox="0 0 25 29" fill="none" aria-hidden="true">
        <path d="M20.4 1.6 3.2 8.2c-2.6 1-2.9 4.6-.5 6l5.8 3.3 3.5-5.3-5.1-2.6L22 4.1a1.35 1.35 0 0 0-1.6-2.5Z" fill="#6A77FF"/>
        <path d="m4.6 27.4 17.2-6.6c2.6-1 2.9-4.6.5-6l-5.8-3.3-3.5 5.3 5.1 2.6L3 24.9a1.35 1.35 0 0 0 1.6 2.5Z" fill="#30A9FF"/>
      </svg>
      {!compact && <span className="text-[18px] font-extrabold tracking-[-.035em] text-white">SPORTSTECH</span>}
    </div>
  );
}
