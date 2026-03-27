interface Props {
  isAbnormal: number | null;
}

export default function StatusBadge({ isAbnormal }: Props) {
  if (isAbnormal === 1) return <span className="badge badge-abnormal">חריג</span>;
  if (isAbnormal === 0) return <span className="badge badge-normal">תקין</span>;
  return <span className="badge badge-unknown">לא ידוע</span>;
}
