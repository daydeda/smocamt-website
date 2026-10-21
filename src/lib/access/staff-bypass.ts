// Staff onboarding bypass list.
//
// Accounts listed here skip the student onboarding form entirely (no studentId,
// major, medical info, emergency contacts or PDPA step). On their first visit to
// /onboarding they are auto-provisioned as `staff` with ONLY a nickname, and are
// dropped into the house with the fewest STAFF members (students are not counted),
// so staff stay balanced across houses independently of the student population
// (see HousesService.pickBalancedHouseIdForStaff / UsersService.provisionStaffBypass).
//
// To add someone: add `"<lowercased-email>": "<nickname>"`. Keys MUST be
// lowercase — getStaffBypassNickname() lowercases the incoming email before
// looking it up.
const STAFF_BYPASS: Record<string, string> = {
  "pailin358812@gmail.com": "ใบเตย",
  "apisaraarunwong@gmail.com": "ดับบลิว",
  "pornpattra.d@gmail.com": "พี่แอนท์",
  "kamolluk.s@camt.info": "บีม",
  "chalisa.s@camt.info": "เหนือ",
  "yonlada.r@camt.info": "แป้ง",
  "pranitnan@camt.info": "นุชชี่",
  "paweena.y@camt.info": "อุ๋ย",
  "settheekk@gmail.com": "อ.ต้นข้าว",
  "kamchai.s1@gmail.com": "เฮง",
  "hrkfan321@gmail.com": "ไทเกอร์",
  "tanasan.te@gmail.com": "แบงค์",
  "meendub@gmail.com": "มีนดุ้บ",
  "sornkamon_int@camt.info": "เนิส",
  "nammon.p@camt.info": "น้ำมนต์",
  "natthakritta@camt.info": "แอมมี่",
  "piyaporn.n@camt.info": "JJ",
  "konlawat.k@camt.info": "อ.จูน",
  "daydedaaa@gmail.com": "ดีเดย์",
  "sumitra.kwan@gmail.com": "พี่ขวัญ",
  "pattaradanai.p@camt.info": "ท๊อฟฟี่",
  "nattawut.w@camt.info": "เบส",
  "jirawit.y@gmail.com": "อ.แอมป์",
  "noppon.w@camt.info": "อ.เอม",
  "nat.t@camt.info": "ต่อ",
  "pattarapansurina42@gmail.com": "มายกี้",
  "apiradee.r@camt.info": "พี่ต้อม",
  "thanutphorn.ch@camt.info": "พี่แยม",
  "witchayaphon.w@camt.info": "พี่ป่าน",
  "sukwan24.56@gmail.com": "พี่สุขวัญ",
  "chonthicha.ro@gmail.com": "พี่วันใหม่",
};

/**
 * Returns the staff nickname for a bypass-listed email, or null if the email is
 * not on the list. Case-insensitive.
 */
export function getStaffBypassNickname(email: string | null | undefined): string | null {
  if (!email) return null;
  return STAFF_BYPASS[email.trim().toLowerCase()] ?? null;
}

/** True if the email belongs to a staff account that bypasses onboarding. */
export function isStaffBypassEmail(email: string | null | undefined): boolean {
  return getStaffBypassNickname(email) !== null;
}
