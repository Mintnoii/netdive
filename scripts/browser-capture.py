"""
NetDive E2E Simulation Browser Automation & Playwright Screenshot Capture
Operates headless Chromium connected to http://localhost:5173.
"""
import sys
import time
from playwright.sync_api import sync_playwright

def run_browser():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={"width": 1600, "height": 960},
            device_scale_factor=2,  # Retina clarity for crisp UI screenshot
        )
        page = context.new_page()

        # 1. 访问 NetDive Web 端点
        page.goto("http://localhost:5173", wait_until="networkidle")
        page.wait_for_timeout(1000)

        # 2. 点击“清空”按钮，保证画布以 0 节点纯净状态就绪
        try:
            clear_btn = page.get_by_role("button", name="清空")
            if clear_btn.is_visible():
                clear_btn.click()
                page.wait_for_timeout(500)
        except Exception as e:
            sys.stderr.write(f"Clear canvas notice: {e}\n")

        # 通知 Node 模拟端浏览器已就绪并建立 WebSocket 连接
        print("READY", flush=True)

        # 3. 循环响应来自 Node 驱动端的指令
        for line in sys.stdin:
            cmd = line.strip()
            if not cmd:
                continue

            if cmd == "APPROVE_GATE":
                try:
                    # 等待门禁审批模态窗并在前端点击【批准放行】
                    approve_btn = page.get_by_role("button", name="批准放行 (Approve)")
                    approve_btn.wait_for(state="visible", timeout=8000)
                    page.wait_for_timeout(300)
                    approve_btn.click()
                    page.wait_for_timeout(500)
                    print("GATE_APPROVED", flush=True)
                except Exception as e:
                    sys.stderr.write(f"Approve gate in browser failed or timed out: {e}\n")
                    print("GATE_APPROVAL_SKIPPED", flush=True)

            elif cmd == "CAPTURE":
                page.wait_for_timeout(1000)
                try:
                    fit_btn = page.locator(".react-flow__controls-fitview")
                    if fit_btn.is_visible():
                        fit_btn.click()
                        page.wait_for_timeout(600)
                except Exception as e:
                    sys.stderr.write(f"Fit view notice: {e}\n")

                output_path = "public/claude-e2e-simulation-verified.png"
                page.screenshot(path=output_path, full_page=True)
                print(f"CAPTURED:{output_path}", flush=True)
                break

            elif cmd == "EXIT":
                break

        browser.close()

if __name__ == "__main__":
    run_browser()
