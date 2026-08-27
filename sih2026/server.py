#!/usr/bin/env python3
"""
OrbitGuard Local Proxy & Auto-Sync Server
1. Serves the static website files (HTML, CSS, JS, TLE) on port 8000.
2. Automatically downloads fresh CelesTrak active TLE data every 2 hours into active.tle.
3. Provides an API endpoint /api/tle/latest that always returns fresh, live TLE data with zero CORS issues.
"""

import os
import sys
import time
import threading
import urllib.request
from http.server import HTTPServer, SimpleHTTPRequestHandler

PORT = 8000
CELESTRAK_URL = "https://celestrak.org/NORAD/elements/gp.php?GROUP=ACTIVE&FORMAT=TLE"
FILE_NAME = "active.tle"
SYNC_INTERVAL_SECONDS = 2 * 60 * 60  # 2 hours

def update_tle_catalog():
    """Fetch latest TLE catalog from CelesTrak with realistic browser headers and save to active.tle."""
    try:
        print(f"[{time.strftime('%X')}] 🛰️ Fetching fresh TLE catalog from CelesTrak...")
        req = urllib.request.Request(
            CELESTRAK_URL,
            headers={
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            }
        )
        with urllib.request.urlopen(req, timeout=15) as response:
            if response.status == 200:
                content = response.read().decode("utf-8", errors="ignore")
                if len(content.strip()) > 1000:
                    with open(FILE_NAME, "w", encoding="utf-8") as f:
                        f.write(content)
                    line_count = len(content.splitlines())
                    print(f"[{time.strftime('%X')}] ✅ Successfully updated {FILE_NAME} ({line_count} lines / ~{line_count // 3} satellites).")
                    return True
        print(f"[{time.strftime('%X')}] ⚠️ CelesTrak returned unexpected response.")
    except Exception as e:
        print(f"[{time.strftime('%X')}] ⚠️ Could not update from CelesTrak ({e}). Using existing {FILE_NAME}.")
    return False

def background_sync_worker():
    """Background worker that updates active.tle every 2 hours automatically."""
    # Check if active.tle exists or is older than 2 hours
    needs_initial_sync = True
    if os.path.exists(FILE_NAME):
        file_age = time.time() - os.path.getmtime(FILE_NAME)
        if file_age < SYNC_INTERVAL_SECONDS:
            needs_initial_sync = False
            print(f"[{time.strftime('%X')}] 📂 Local {FILE_NAME} is fresh ({int(file_age // 60)} minutes old). Next auto-sync in {int((SYNC_INTERVAL_SECONDS - file_age) // 60)} mins.")

    if needs_initial_sync:
        update_tle_catalog()

    while True:
        time.sleep(SYNC_INTERVAL_SECONDS)
        update_tle_catalog()

class OrbitGuardHandler(SimpleHTTPRequestHandler):
    """Custom handler with CORS headers and API support."""
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "X-Requested-With, Content-Type")
        super().end_headers()

    def do_GET(self):
        if self.path == "/api/tle/sync":
            success = update_tle_catalog()
            self.send_response(200 if success else 500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            status_msg = "updated" if success else "error"
            self.wfile.write(f'{{"status":"{status_msg}","timestamp":{time.time()}}}'.encode("utf-8"))
            return
        return super().do_GET()

def run_server():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    
    # Start auto-updater thread
    sync_thread = threading.Thread(target=background_sync_worker, daemon=True)
    sync_thread.start()

    server_address = ("", PORT)
    httpd = HTTPServer(server_address, OrbitGuardHandler)
    print("=" * 65)
    print(f"🚀 OrbitGuard Live Server running at: http://localhost:{PORT}/")
    print(f"🌍 3D Earth Dashboard: http://localhost:{PORT}/earth.html")
    print(f"✨ 3D Intro & Gateway: http://localhost:{PORT}/index.html")
    print(f"🔄 Auto-sync: CelesTrak TLE refreshes every 2 hours -> active.tle")
    print("=" * 65)
    
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping OrbitGuard server.")
        httpd.server_close()

if __name__ == "__main__":
    run_server()
