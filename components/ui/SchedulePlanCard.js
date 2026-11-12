const UNKNOWN = "ยังไม่มีข้อมูล";

function formatDateTime(value, withTime) {
  if (!value) return UNKNOWN;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return UNKNOWN;
  return new Intl.DateTimeFormat("th-TH", {
    day: "numeric", month: "long", year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
    timeZone: "Asia/Bangkok",
  }).format(date) + (withTime ? " น." : "");
}

function stepState(value, now) {
  const time = value ? new Date(value).getTime() : NaN;
  if (Number.isNaN(time)) return "unknown";
  return time <= now ? "done" : "upcoming";
}

export default function SchedulePlanCard({ announceDate, opensAt, closesAt, contractStart, contractEnd, durationDays }) {
  const now = Date.now();
  const steps = [
    { key: "announce", label: "ประกาศโครงการ", value: announceDate, withTime: false },
    { key: "opens", label: "เริ่มรับข้อเสนอ", value: opensAt, withTime: true },
    { key: "closes", label: "ปิดรับข้อเสนอ", value: closesAt, withTime: true },
    { key: "contract-start", label: "เริ่มสัญญา", value: contractStart, withTime: false },
    { key: "contract-end", label: "สิ้นสุดสัญญา", value: contractEnd, withTime: false },
  ];
  const hasAny = steps.some((step) => step.value);

  return (
    <section className="tor-schedule-plan tor-summary-card" aria-label="กำหนดการโครงการ">
      <p className="tor-section-kicker">กำหนดการ</p>
      <h2>Schedule Plan</h2>
      {hasAny ? (
        <>
          <ol className="tor-schedule-list">
            {steps.map((step) => (
              <li key={step.key} className={`is-${stepState(step.value, now)}`}>
                <span>{step.label}</span>
                <strong>{formatDateTime(step.value, step.withTime)}</strong>
              </li>
            ))}
          </ol>
          {durationDays ? <p className="tor-schedule-duration">ระยะเวลาสัญญา {Number(durationDays).toLocaleString("th-TH")} วัน</p> : null}
        </>
      ) : <p>ยังไม่มีข้อมูลกำหนดการ</p>}
    </section>
  );
}
