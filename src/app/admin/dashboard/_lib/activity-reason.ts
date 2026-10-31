import type { useLanguage } from "@/lib/i18n/LanguageContext";

type LangCtx = ReturnType<typeof useLanguage>;

/** House display name from a colour id / house name, in the viewer's language. */
export function translateHouseName(t: LangCtx["t"], idOrName: string, defaultName: string): string {
  const key = idOrName.toLowerCase();
  if (key === "red" || key === "mom") return t.houseMom || "Mom";
  if (key === "green" || key === "to") return t.houseTo || "To";
  if (key === "yellow" || key === "luang") return t.houseLuang || "Luang";
  if (key === "blue" || key === "makara") return t.houseMakara || "Makon";
  return defaultName;
}

/**
 * Activity reasons are stored in English by the server. This rewrites the known
 * templates into the viewer's language (EN/TH/MM/CN) and leaves anything else as is.
 */
export function translateActivityReason(reason: string, lang: LangCtx["lang"], t: LangCtx["t"]): string {
  const getTranslatedHouseName = (idOrName: string, defaultName: string) => translateHouseName(t, idOrName, defaultName);
  if (!reason) return "";

  // 1. Awarded X pts to Y - Reason: Z (from activity "W")
  const match1 = reason.match(/^Awarded (\d+) pts to (.+?) - Reason: (.+?) \(from activity "(.+?)"\)$/);
  if (match1) {
    const [, pts, student, res, activity] = match1;
    if (lang === "th") return `มอบ ${pts} คะแนนให้กับ ${student} - เหตุผล: ${res} (จากกิจกรรม "${activity}")`;
    if (lang === "mm") return `${student} သို့ ${pts} မှတ်ပေးအပ်သည် - အကြောင်းပြချက်: ${res} (လှုပ်ရှားမှု "${activity}" မှ)`;
    if (lang === "cn") return `向 ${student} 奖励 ${pts} 积分 - 原因: ${res} (来自活动 "${activity}")`;
    return reason;
  }

  // 2. Awarded X individual points to Y from activity "W"
  const match2 = reason.match(/^Awarded (\d+) individual points to (.+?) from activity "(.+?)"$/);
  if (match2) {
    const [, pts, student, activity] = match2;
    if (lang === "th") return `มอบคะแนนรายบุคคล ${pts} คะแนนให้กับ ${student} จากกิจกรรม "${activity}"`;
    if (lang === "mm") return `${student} သို့ လှုပ်ရှားမှု "${activity}" မှ တစ်ဦးချင်းရမှတ် ${pts} မှတ်ပေးအပ်သည်`;
    if (lang === "cn") return `向 ${student} 奖励个人积分 ${pts} 分 (来自活动 "${activity}")`;
    return reason;
  }

  // 3. Student Y reached 100 point milestone (+Z total points) from activity "W"
  const match3 = reason.match(/^Student (.+?) reached 100 point milestone \(\+(\d+) total points\) from activity "(.+?)"$/);
  if (match3) {
    const [, student, total, activity] = match3;
    if (lang === "th") return `นักศึกษา ${student} สะสมคะแนนครบ 100 คะแนน (รวมเป็น ${total} คะแนน) จากกิจกรรม "${activity}"`;
    if (lang === "mm") return `ကျောင်းသား ${student} သည် လှုပ်ရှားမှု "${activity}" မှ တစ်ဦးချင်းရမှတ် ၁၀၀ ပြည့်သွားပါသည် (စုစုပေါင်း ${total} မှတ်)`;
    if (lang === "cn") return `学生 ${student} 累计积分达到 100 分里程碑 (共计 ${total} 分，来自活动 "${activity}")`;
    return reason;
  }

  // 4. Event Form Contest Winner: X House completed the evaluation form "Y" most with Z submissions! Received W PTS.
  const match4 = reason.match(/^Event Form Contest Winner: (.+?) House completed the evaluation form "(.+?)" most with (\d+) submissions! Received (\d+) PTS\.$/);
  if (match4) {
    const [, house, formTitle, subs, pts] = match4;
    const translatedHouse = getTranslatedHouseName(house.toLowerCase(), house);
    if (lang === "th") return `ผู้ชนะการประกวดฟอร์มกิจกรรม: ${translatedHouse} ส่งแบบประเมิน "${formTitle}" มากที่สุดจำนวน ${subs} ครั้ง! ได้รับ ${pts} คะแนน`;
    if (lang === "mm") return `အကဲဖြတ်လွှာ တင်သွင်းမှုအများဆုံးဆု - ${translatedHouse} အိမ်သည် အကဲဖြတ်လွှာ "${formTitle}" ကို အများဆုံး ${subs} ကြိမ် တင်သွင်းပြီး ${pts} မှတ် ရရှိခဲ့သည်!`;
    if (lang === "cn") return `活动表单竞赛优胜者：${translatedHouse} 学院以 ${subs} 次提交最多完成了评估表 "${formTitle}"！获得 ${pts} 积分。`;
    return reason;
  }

  // 5. Event Form Contest Tie Winner: X House completed the evaluation form "Y" most with Z submissions! Shared W PTS.
  const match5 = reason.match(/^Event Form Contest Tie Winner: (.+?) House completed the evaluation form "(.+?)" most with (\d+) submissions! Shared (\d+) PTS\.$/);
  if (match5) {
    const [, house, formTitle, subs, pts] = match5;
    const translatedHouse = getTranslatedHouseName(house.toLowerCase(), house);
    if (lang === "th") return `ผู้ชนะร่วมประกวดฟอร์มกิจกรรม: ${translatedHouse} ส่งแบบประเมิน "${formTitle}" มากที่สุดจำนวน ${subs} ครั้ง! แบ่งกันได้รับ ${pts} คะแนน`;
    if (lang === "mm") return `အကဲဖြတ်လွှာ တင်သွင်းမှုအများဆုံး ပူးတွဲဆု - ${translatedHouse} အိမ်သည် အကဲဖြတ်လွှာ "${formTitle}" ကို အများဆုံး ${subs} ကြိမ် တင်သွင်းပြီး ${pts} မှတ် ခွဲဝေရရှိခဲ့သည်!`;
    if (lang === "cn") return `活动表单竞赛并列优胜者：${translatedHouse} 学院以 ${subs} 次提交完成了评估表 "${formTitle}"！平分获得 ${pts} 积分。`;
    return reason;
  }

  // 6. Event "X" completed! WINNER: Y House won with Z attendees! Received W PTS.
  const match6 = reason.match(/^Event "(.+?)" completed! WINNER: (.+?) House won with (\d+) attendees! Received (\d+) PTS\.$/);
  if (match6) {
    const [, eventTitle, house, atts, pts] = match6;
    const translatedHouse = getTranslatedHouseName(house.toLowerCase(), house);
    if (lang === "th") return `กิจกรรม "${eventTitle}" เสร็จสิ้น! ${translatedHouse} ชนะด้วยจำนวนผู้เข้าร่วม ${atts} คน! ได้รับ ${pts} คะแนน`;
    if (lang === "mm") return `လှုပ်ရှားမှု "${eventTitle}" ပြီးဆုံးပါပြီ။ အနိုင်ရရှိသူ - ${translatedHouse} အိမ်သည် တက်ရောက်သူ ${atts} ဦးဖြင့် အနိုင်ရရှိပြီး ${pts} မှတ် ရရှိခဲ့သည်!`;
    if (lang === "cn") return `活动 "${eventTitle}" 已结束！获胜者：${translatedHouse} 学院以 ${atts} 位到场人数获胜！获得 ${pts} 积分。`;
    return reason;
  }

  // 7. Event "X" completed! TIE WINNER: Y House won with Z attendees! Shared W PTS.
  const match7 = reason.match(/^Event "(.+?)" completed! TIE WINNER: (.+?) House won with (\d+) attendees! Shared (\d+) PTS\.$/);
  if (match7) {
    const [, eventTitle, house, atts, pts] = match7;
    const translatedHouse = getTranslatedHouseName(house.toLowerCase(), house);
    if (lang === "th") return `กิจกรรม "${eventTitle}" เสร็จสิ้น! ผู้ชนะร่วม: ${translatedHouse} ชนะด้วยจำนวนผู้เข้าร่วม ${atts} คน! แบ่งกันได้รับ ${pts} คะแนน`;
    if (lang === "mm") return `လှုပ်ရှားမှု "${eventTitle}" ပြီးဆုံးပါပြီ။ ပူးတွဲအနိုင်ရရှိသူ - ${translatedHouse} အိမ်သည် တက်ရောက်သူ ${atts} ဦးဖြင့် အနိုင်ရရှိပြီး ${pts} မှတ် ခွဲဝေရရှိခဲ့သည်!`;
    if (lang === "cn") return `活动 "${eventTitle}" 已结束！并列获胜者：${translatedHouse} 学院以 ${atts} 位到场人数获胜！平分获得 ${pts} 积分。`;
    return reason;
  }

  // 8. Event "X" ended with no attendees. No points awarded.
  const match8 = reason.match(/^Event "(.+?)" ended with no attendees\. No points awarded\.$/);
  if (match8) {
    const [, eventTitle] = match8;
    if (lang === "th") return `กิจกรรม "${eventTitle}" สิ้นสุดลงแต่ไม่มีผู้เข้าร่วม ไม่มีการมอบคะแนน`;
    if (lang === "mm") return `လှုပ်ရှားမှု "${eventTitle}" ပြီးဆုံးသော်လည်း တက်ရောက်သူမရှိပါ။ မည်သည့်အမှတ်မှ มရရှိပါ။`;
    if (lang === "cn") return `活动 "${eventTitle}" 已结束，但无到场人员。未授予积分。`;
    return reason;
  }

  // 9. Event "X" ended but all checked-in students were unassigned. No points awarded.
  const match9 = reason.match(/^Event "(.+?)" ended but all checked-in students were unassigned\. No points awarded\.$/);
  if (match9) {
    const [, eventTitle] = match9;
    if (lang === "th") return `กิจกรรม "${eventTitle}" สิ้นสุดลงแต่ผู้เข้าเช็คอินไม่มีสังกัด ไม่มีการมอบคะแนน`;
    if (lang === "mm") return `လှုပ်ရှားမှု "${eventTitle}" ပြီးဆုံးသော်လည်း တက်ရောက်သူအားလုံးသည် အိမ်မသတ်မှတ်ရသေးသူများဖြစ်ကြသည်။ မည်သည့်အမှတ်မှ မရရှိပါ။`;
    if (lang === "cn") return `活动 "${eventTitle}" 已结束，但所有签到的学生均未分配学院。未授予积分。`;
    return reason;
  }

  return reason;
}
