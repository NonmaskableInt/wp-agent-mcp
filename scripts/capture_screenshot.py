from playwright.sync_api import sync_playwright

def capture(url, output_path, viewport_width=1920, viewport_height=1080, user_agent=None):
    with sync_playwright() as p:
        browser = p.chromium.launch()
        kwargs = {'viewport': {'width': viewport_width, 'height': viewport_height}}
        if user_agent:
            kwargs['user_agent'] = user_agent
        page = browser.new_page(**kwargs)
        page.goto(url, wait_until='networkidle', timeout=30000)
        # Wait a bit for any animations or lazy loads
        page.wait_for_timeout(2000)
        page.screenshot(path=output_path, full_page=False)
        browser.close()

if __name__ == '__main__':
    import sys
    url = sys.argv[1] if len(sys.argv) > 1 else 'https://example.com'
    output = sys.argv[2] if len(sys.argv) > 2 else 'screenshot.png'
    width = int(sys.argv[3]) if len(sys.argv) > 3 else 1920
    height = int(sys.argv[4]) if len(sys.argv) > 4 else 1080
    capture(url, output, width, height)
    print(f'Saved: {output}')
