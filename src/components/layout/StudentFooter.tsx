"use client";

import { useLanguage } from "@/lib/LanguageContext";

// Site-wide credit/copyright footer for the student-facing pages. Mounted once
// from the dashboard/ and battle/ layouts (not per page like StudentNav), so
// every student page gets it without each page having to remember it. The
// full SMO CAMT logo lives here rather than next to the ActiveCAMT wordmark in
// the nav, which keeps the top bar about the product and puts the
// organisation credit where credits conventionally go.
export function StudentFooter() {
const { t } = useLanguage();
const year = new Date().getFullYear();

return (
<footer className="student-footer">
<div className="footer-content">
<img
src="/smocamt-logo-footer.png"
alt="SMO CAMT"
className="footer-logo"
width={72}
height={72}
loading="lazy"
/>
<div className="footer-text">
<p className="footer-credit">{t.footerCredit}</p>
<p className="footer-copyright">
© {year} SMO CAMT. {t.footerRights}
</p>
</div>
</div>

<style jsx>{`
.student-footer {
background: var(--bg-base);
border-top: 1px solid var(--border-subtle);
padding: 32px 24px calc(32px + var(--safe-bottom, 0px));
}
.footer-content {
max-width: 1400px;
margin: 0 auto;
display: flex;
align-items: center;
justify-content: center;
gap: 20px;
}
.footer-logo {
width: 72px;
height: 72px;
object-fit: contain;
flex-shrink: 0;
}
.footer-text {
display: flex;
flex-direction: column;
gap: 4px;
max-width: 560px;
}
.footer-credit {
margin: 0;
font-size: 13px;
font-weight: 600;
color: var(--text-secondary);
line-height: 1.5;
}
.footer-copyright {
margin: 0;
font-size: 12px;
font-weight: 700;
color: var(--text-muted);
letter-spacing: 0.02em;
}
/* Mobile: stack centered, and leave room at the bottom so the fixed
   battle FAB (bottom-right, see StudentNav) never sits on the text. */
@media (max-width: 1023px) {
.student-footer {
padding-bottom: calc(88px + var(--safe-bottom, 0px));
}
.footer-content {
flex-direction: column;
text-align: center;
gap: 12px;
}
}
`}</style>
</footer>
);
}
