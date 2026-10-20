"use client";

// Privacy policy text, shared by the public /privacy page and the onboarding
// consent modal so the two can never drift apart. EN + TH only: MM/CN visitors
// see EN (same fallback as admin strings).

export const PRIVACY_CONTACT_EMAIL = "smocamt.official@camt.info";
export const PRIVACY_UPDATED = "2026-10-20";

export type PrivacyLang = "en" | "th";

type Section = { id: string; title: string; body: string[] };

type Copy = {
  pageTitle: string;
  updated: string;
  intro: string;
  onThisPage: string;
  sections: Section[];
  contactTitle: string;
  contactBody: string;
  back: string;
};

export const PRIVACY_COPY: Record<PrivacyLang, Copy> = {
  en: {
    pageTitle: "Privacy Policy",
    updated: "Last updated",
    intro:
      "ActiveCAMT is the student activity, attendance and house-points platform of the College of Arts, Media and Technology (CAMT), Chiang Mai University. It is overseen by the Student Quality Development Unit, CAMT, and the Student Association of the College of Arts, Media and Technology (SMO).",
    onThisPage: "On this page",
    sections: [
      {
        id: "who",
        title: "Who we are",
        body: [
          "ActiveCAMT is run by the Student Quality Development Unit of the College of Arts, Media and Technology (CAMT) together with the Student Association of the College of Arts, Media and Technology (SMO).",
          "Questions about this policy can be sent to the contact address at the bottom of this page.",
        ],
      },
      {
        id: "data",
        title: "Personal data we collect",
        body: [
          "When you sign in with Google, we receive your name, email address and profile picture.",
          "We also store what you give us for your student activity record: your student profile, club or major, event registrations, attendance check-ins, points and shop orders.",
          "Some forms ask for health-related information or emergency contacts. We keep this to the minimum needed and restrict who can see it.",
        ],
      },
      {
        id: "use",
        title: "Why we use it",
        body: [
          "To run activities, record attendance, award house points, process shop orders, send notifications and keep the platform secure.",
          "Health information and emergency contacts are used only to look after your safety during activities.",
          "We do not sell your personal data.",
        ],
      },
      {
        id: "backups",
        title: "Backups",
        body: [
          "To protect against data loss, the platform database is backed up once a day. Each backup is a full copy of the database, compressed and uploaded to a private Google Drive folder controlled by the SMO.",
          "Backups older than 30 days are deleted automatically.",
          "Because a backup is a full copy, it contains the same personal data as the live database. Access to backups is limited to authorised staff.",
        ],
      },
      {
        id: "access",
        title: "Who can access your data",
        body: [
          "Access is limited by role. Student activity staff, club and major presidents and authorised administrators see only the parts of the data they need for their work.",
          "Every access to sensitive data, such as health information, is recorded in an audit log.",
        ],
      },
      {
        id: "rights",
        title: "Your rights",
        body: [
          "Under Thailand's Personal Data Protection Act (PDPA) you can request access to, correction of, or deletion of your personal data, and you can object to or restrict some kinds of processing.",
          "Send your request to the contact address below.",
        ],
      },
      {
        id: "changes",
        title: "Changes to this policy",
        body: ["We may update this policy. The date at the top of the page shows when it last changed."],
      },
    ],
    contactTitle: "Questions or requests?",
    contactBody: "Contact the Student Association (SMO) of the College of Arts, Media and Technology:",
    back: "Back to ActiveCAMT",
  },
  th: {
    pageTitle: "นโยบายความเป็นส่วนตัว",
    updated: "อัปเดตล่าสุด",
    intro:
      "ActiveCAMT เป็นแพลตฟอร์มกิจกรรมนักศึกษา การเช็คชื่อ และคะแนนบ้าน ของวิทยาลัยศิลปะ สื่อ และเทคโนโลยี (CAMT) มหาวิทยาลัยเชียงใหม่ ดูแลกำกับโดยหน่วยพัฒนาคุณภาพนักศึกษา วิทยาลัยศิลปะ สื่อ และเทคโนโลยี และสโมสรนักศึกษาวิทยาลัยศิลปะ สื่อ และเทคโนโลยี (SMO)",
    onThisPage: "ในหน้านี้",
    sections: [
      {
        id: "who",
        title: "ผู้ดูแลระบบ",
        body: [
          "ActiveCAMT ดูแลกำกับโดยหน่วยพัฒนาคุณภาพนักศึกษา วิทยาลัยศิลปะ สื่อ และเทคโนโลยี และสโมสรนักศึกษาวิทยาลัยศิลปะ สื่อ และเทคโนโลยี (SMO)",
          "หากมีข้อสงสัยเกี่ยวกับนโยบายนี้ ติดต่อได้ตามช่องทางท้ายหน้า",
        ],
      },
      {
        id: "data",
        title: "ข้อมูลส่วนบุคคลที่เราเก็บ",
        body: [
          "เมื่อเข้าสู่ระบบด้วย Google เราจะได้รับชื่อ อีเมล และรูปโปรไฟล์ของคุณ",
          "เรายังเก็บข้อมูลที่คุณให้เพื่อบันทึกประวัติกิจกรรม ได้แก่ ข้อมูลนักศึกษา ชมรมหรือสาขา การลงทะเบียนกิจกรรม การเช็คชื่อ คะแนน และคำสั่งซื้อในร้านค้า",
          "บางแบบฟอร์มอาจขอข้อมูลสุขภาพหรือผู้ติดต่อฉุกเฉิน เราเก็บเท่าที่จำเป็นและจำกัดผู้ที่เข้าถึงได้",
        ],
      },
      {
        id: "use",
        title: "วัตถุประสงค์ในการใช้ข้อมูล",
        body: [
          "เพื่อจัดกิจกรรม บันทึกการเข้าร่วม มอบคะแนนบ้าน ประมวลผลคำสั่งซื้อ ส่งการแจ้งเตือน และรักษาความปลอดภัยของระบบ",
          "ข้อมูลสุขภาพและผู้ติดต่อฉุกเฉินใช้เพื่อดูแลความปลอดภัยของคุณระหว่างกิจกรรมเท่านั้น",
          "เราไม่ขายข้อมูลส่วนบุคคลของคุณ",
        ],
      },
      {
        id: "backups",
        title: "การสำรองข้อมูล",
        body: [
          "เพื่อป้องกันข้อมูลสูญหาย ระบบจะสำรองฐานข้อมูลวันละหนึ่งครั้ง โดยเป็นสำเนาทั้งฐานข้อมูล บีบอัดแล้วอัปโหลดไปยังโฟลเดอร์ Google Drive ส่วนตัวที่ SMO ดูแล",
          "ไฟล์สำรองที่เก่ากว่า 30 วันจะถูกลบโดยอัตโนมัติ",
          "เนื่องจากไฟล์สำรองเป็นสำเนาทั้งหมด จึงมีข้อมูลส่วนบุคคลชุดเดียวกับฐานข้อมูลจริง และเข้าถึงได้เฉพาะเจ้าหน้าที่ที่ได้รับอนุญาต",
        ],
      },
      {
        id: "access",
        title: "ใครเข้าถึงข้อมูลของคุณได้",
        body: [
          "การเข้าถึงจำกัดตามบทบาท เจ้าหน้าที่กิจกรรมนักศึกษา ประธานชมรมหรือสาขา และผู้ดูแลระบบที่ได้รับอนุญาต จะเห็นเฉพาะส่วนที่จำเป็นต่อหน้าที่ของตน",
          "การเข้าถึงข้อมูลอ่อนไหว เช่น ข้อมูลสุขภาพ ทุกครั้งจะถูกบันทึกไว้ในบันทึกการตรวจสอบ",
        ],
      },
      {
        id: "rights",
        title: "สิทธิของคุณ",
        body: [
          "ตามพระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562 (PDPA) คุณมีสิทธิขอเข้าถึง แก้ไข หรือลบข้อมูลส่วนบุคคลของคุณ และคัดค้านหรือจำกัดการประมวลผลบางประเภทได้",
          "ส่งคำขอได้ที่ช่องทางติดต่อด้านล่าง",
        ],
      },
      {
        id: "changes",
        title: "การเปลี่ยนแปลงนโยบาย",
        body: ["เราอาจปรับปรุงนโยบายนี้ วันที่ด้านบนของหน้าแสดงวันที่แก้ไขล่าสุด"],
      },
    ],
    contactTitle: "มีคำถามหรือต้องการใช้สิทธิ?",
    contactBody: "ติดต่อสโมสรนักศึกษาวิทยาลัยศิลปะ สื่อ และเทคโนโลยี (SMO):",
    back: "กลับสู่ ActiveCAMT",
  },
};

/** Maps the app language to the policy language (MM/CN fall back to EN). */
export function privacyLangFor(lang: string): PrivacyLang {
  return lang === "th" ? "th" : "en";
}

export const privacyCard: React.CSSProperties = {
  background: "var(--bg-surface)",
  border: "1px solid var(--border-medium)",
  borderRadius: "var(--radius-lg)",
  padding: "22px 22px 20px",
};

/** Numbered section cards plus the contact card. */
export function PrivacySections({ lang, compact = false }: { lang: PrivacyLang; compact?: boolean }) {
  const c = PRIVACY_COPY[lang];
  const card = compact ? { ...privacyCard, padding: "18px 16px 16px" } : privacyCard;

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: compact ? 10 : 14 }}>
        {c.sections.map((s, i) => (
          <section key={s.id} id={compact ? undefined : s.id} style={{ ...card, scrollMarginTop: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <span
                aria-hidden
                style={{
                  flexShrink: 0,
                  width: 30,
                  height: 30,
                  borderRadius: 10,
                  display: "grid",
                  placeItems: "center",
                  fontSize: 14,
                  fontWeight: 800,
                  background: "var(--accent-glow)",
                  color: "var(--accent-primary)",
                }}
              >
                {i + 1}
              </span>
              <h3 style={{ fontSize: compact ? 16 : 18, fontWeight: 700, color: "var(--text-primary)" }}>{s.title}</h3>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {s.body.map((p) => (
                <p key={p} style={{ fontSize: compact ? 14 : 15, lineHeight: 1.75, color: "var(--text-secondary)" }}>
                  {p}
                </p>
              ))}
            </div>
          </section>
        ))}
      </div>

      <div
        style={{
          ...card,
          marginTop: compact ? 12 : 20,
          background: "var(--accent-glow)",
          border: "1px solid var(--accent-primary)",
        }}
      >
        <h3 style={{ fontSize: 17, fontWeight: 700, color: "var(--text-primary)", marginBottom: 6 }}>{c.contactTitle}</h3>
        <p style={{ fontSize: 14, lineHeight: 1.7, color: "var(--text-secondary)", marginBottom: 10 }}>{c.contactBody}</p>
        <a
          href={`mailto:${PRIVACY_CONTACT_EMAIL}`}
          style={{ fontSize: 15, fontWeight: 700, color: "var(--accent-primary)", textDecoration: "underline" }}
        >
          {PRIVACY_CONTACT_EMAIL}
        </a>
      </div>
    </>
  );
}
