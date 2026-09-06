import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
MODE = sys.argv[2]
RESP = {
 "400":      (400, b'{"error":"Invalid Request"}'),
 "dailycap": (429, b'{"error":"Rate Limited Day - You have exceeded your daily request limit"}'),
 "persec":   (429, b'{"error":"Rate Limited Second"}'),
 "500":      (500, b'oops'),
 "empty":    (200, b'[]'),
 "errbody":  (200, b'{"error":"Unable to geocode"}'),
 "ok":       (200, b'[{"lat":"64.14","lon":"-21.9","display_name":"Place, Reykjavik, Iceland",'
                   b'"address":{"city":"Reykjavik","country_code":"is"}}]'),
}
class H(BaseHTTPRequestHandler):
    def do_GET(self):
        code, body = RESP.get(MODE, (200, b'[]'))
        self.send_response(code)
        self.send_header("Content-Type","application/json")
        self.send_header("Content-Length",str(len(body)))
        self.end_headers(); self.wfile.write(body)
    def log_message(self,*a): pass
HTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
