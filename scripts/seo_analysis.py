from playwright.sync_api import sync_playwright
import json

URL = 'https://example.com'

results = {}

with sync_playwright() as p:
    browser = p.chromium.launch()

    # --- DESKTOP (1920x1080) ---
    page = browser.new_page(viewport={'width': 1920, 'height': 1080})
    page.goto(URL, wait_until='networkidle', timeout=30000)
    page.wait_for_timeout(2000)
    page.screenshot(path='./screenshots/desktop_1920.png', full_page=False)

    # Grab key desktop metrics
    results['desktop'] = page.evaluate('''() => {
        const h1 = document.querySelector('h1');
        const h2 = document.querySelector('h2');
        const nav = document.querySelector('nav, header');
        const cta = document.querySelector('a.btn, a.button, button, .cta, [class*="cta"], [class*="btn"]');
        const meta_desc = document.querySelector('meta[name="description"]');
        const viewport_h = window.innerHeight;
        const viewport_w = window.innerWidth;

        function isAboveFold(el) {
            if (!el) return false;
            const rect = el.getBoundingClientRect();
            return rect.top < viewport_h && rect.bottom > 0;
        }

        function hasHorizScroll() {
            return document.body.scrollWidth > document.body.clientWidth;
        }

        // Find all CTAs
        const allCTAs = [...document.querySelectorAll('a.btn, a.button, button, .cta, [class*="cta"], [class*="btn"], a[href*="contact"], a[href*="get-started"], a[href*="demo"]')];
        const aboveFoldCTAs = allCTAs.filter(el => isAboveFold(el));

        // Find popups/modals/interstitials
        const modals = [...document.querySelectorAll('[class*="modal"], [class*="popup"], [class*="overlay"], [class*="interstitial"], [id*="modal"], [id*="popup"]')];
        const visibleModals = modals.filter(el => {
            const s = window.getComputedStyle(el);
            return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
        });

        // Get all text above fold
        const bodyText = document.body.innerText.slice(0, 500);

        return {
            title: document.title,
            meta_description: meta_desc ? meta_desc.getAttribute('content') : null,
            h1_text: h1 ? h1.innerText.trim() : null,
            h1_above_fold: isAboveFold(h1),
            h2_text: h2 ? h2.innerText.trim() : null,
            cta_text: cta ? cta.innerText.trim() : null,
            cta_above_fold: isAboveFold(cta),
            all_ctas_count: allCTAs.length,
            above_fold_ctas: aboveFoldCTAs.map(el => ({ text: el.innerText.trim().slice(0,60), tag: el.tagName })),
            has_horizontal_scroll: hasHorizScroll(),
            visible_modals: visibleModals.map(el => ({ tag: el.tagName, class: el.className.slice(0,80) })),
            viewport_w: viewport_w,
            viewport_h: viewport_h,
            body_scroll_width: document.body.scrollWidth,
            body_snippet: bodyText
        };
    }''')
    page.close()

    # --- MOBILE (375x812, iPhone) ---
    mobile_ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'
    page = browser.new_page(viewport={'width': 375, 'height': 812}, user_agent=mobile_ua)
    page.goto(URL, wait_until='networkidle', timeout=30000)
    page.wait_for_timeout(2000)
    page.screenshot(path='./screenshots/mobile_375.png', full_page=False)

    results['mobile'] = page.evaluate('''() => {
        const h1 = document.querySelector('h1');
        const h2 = document.querySelector('h2');
        const nav = document.querySelector('nav, header');
        const viewport_h = window.innerHeight;
        const viewport_w = window.innerWidth;

        function isAboveFold(el) {
            if (!el) return false;
            const rect = el.getBoundingClientRect();
            return rect.top < viewport_h && rect.bottom > 0;
        }

        function hasHorizScroll() {
            return document.body.scrollWidth > document.body.clientWidth;
        }

        // Check tap target sizes
        const interactables = [...document.querySelectorAll('a, button, input, select, textarea, [role="button"]')];
        const smallTargets = interactables.filter(el => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && (rect.width < 48 || rect.height < 48);
        }).map(el => ({ text: el.innerText.trim().slice(0,40), w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) }));

        // Check font sizes
        const paragraphs = [...document.querySelectorAll('p, li, span, div')].filter(el => el.childElementCount === 0 && el.innerText.trim().length > 10);
        const smallFonts = paragraphs.filter(el => {
            const fs = parseFloat(window.getComputedStyle(el).fontSize);
            return fs > 0 && fs < 16;
        }).map(el => ({ text: el.innerText.trim().slice(0,40), fontSize: parseFloat(window.getComputedStyle(el).fontSize) })).slice(0,5);

        // Find popups/modals/interstitials
        const modals = [...document.querySelectorAll('[class*="modal"], [class*="popup"], [class*="overlay"], [class*="interstitial"], [id*="modal"], [id*="popup"]')];
        const visibleModals = modals.filter(el => {
            const s = window.getComputedStyle(el);
            return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
        });

        const allCTAs = [...document.querySelectorAll('a.btn, a.button, button, .cta, [class*="cta"], [class*="btn"], a[href*="contact"], a[href*="get-started"], a[href*="demo"]')];
        const aboveFoldCTAs = allCTAs.filter(el => isAboveFold(el));

        return {
            h1_text: h1 ? h1.innerText.trim() : null,
            h1_above_fold: isAboveFold(h1),
            cta_above_fold: aboveFoldCTAs.length > 0,
            above_fold_ctas: aboveFoldCTAs.map(el => ({ text: el.innerText.trim().slice(0,60), tag: el.tagName, w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) })),
            has_horizontal_scroll: hasHorizScroll(),
            body_scroll_width: document.body.scrollWidth,
            viewport_w: viewport_w,
            small_tap_targets: smallTargets.slice(0, 10),
            small_tap_targets_total: smallTargets.length,
            small_font_samples: smallFonts,
            small_fonts_total: paragraphs.filter(el => parseFloat(window.getComputedStyle(el).fontSize) < 16).length,
            visible_modals: visibleModals.map(el => ({ tag: el.tagName, class: el.className.slice(0,80) })),
            nav_visible: isAboveFold(nav),
        };
    }''')
    page.close()

    # --- LAPTOP (1366x768) ---
    page = browser.new_page(viewport={'width': 1366, 'height': 768})
    page.goto(URL, wait_until='networkidle', timeout=30000)
    page.wait_for_timeout(1500)
    page.screenshot(path='./screenshots/laptop_1366.png', full_page=False)
    page.close()

    # --- TABLET (768x1024) ---
    page = browser.new_page(viewport={'width': 768, 'height': 1024})
    page.goto(URL, wait_until='networkidle', timeout=30000)
    page.wait_for_timeout(1500)
    page.screenshot(path='./screenshots/tablet_768.png', full_page=False)
    page.close()

    browser.close()

print(json.dumps(results, indent=2))
