#!/bin/bash
cd "$(dirname "$0")"
PORT=8765
(sleep 0.6 && open -a "Google Chrome" "http://127.0.0.1:${PORT}/") &
echo "Đang chạy server tại http://127.0.0.1:${PORT} (Nhấn Ctrl+C để dừng)"
python3 -m http.server ${PORT} --bind 127.0.0.1
