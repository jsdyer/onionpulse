"""Check the historical event, its attribution and chart controls in Chrome."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from playwright.sync_api import sync_playwright


def main():
    directory = Path(__file__).resolve().parents[1] / "dist"
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(SimpleHTTPRequestHandler, directory=directory))
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as play:
            browser = play.chromium.launch(channel="chrome")
            page = browser.new_page(viewport={"width": 390, "height": 844})
            page.goto(f"http://127.0.0.1:{server.server_port}/")
            page.locator('[data-event="ca"]').click()
            page.locator("#counting-note").wait_for()
            page.wait_for_function("document.querySelector('#inspect-date').textContent === '2026-10-29'")
            assert "Canada" in page.locator("#inspect-values").inner_text()
            assert "2026-10-29" in page.locator("#range-summary").inner_text()
            assert "userstats-relay-country" in page.locator("#chart-source").get_attribute("href")
            page.locator("#metric").select_option("size")
            page.locator("#counting-note").wait_for(state="hidden")
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
            browser.close()
    finally:
        server.shutdown()


if __name__ == "__main__":
    main()
