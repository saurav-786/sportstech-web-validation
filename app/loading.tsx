export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        {Array.from({ length: 8 }, (_, index) => <div key={index} className="skeleton h-[112px] rounded-xl"/>)}
      </div>
      <div className="grid gap-4 xl:grid-cols-[1fr_335px]">
        <div className="skeleton h-[510px] rounded-xl"/>
        <div className="skeleton h-[510px] rounded-xl"/>
      </div>
      <div className="skeleton h-[260px] rounded-xl"/>
    </div>
  );
}
