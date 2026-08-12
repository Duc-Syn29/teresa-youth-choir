# Worker quản trị Teresa

Worker này chỉ là cầu nối bảo mật: xác minh Firebase ID token, kiểm tra đúng email quản trị, rồi ghi file dữ liệu/ảnh vào GitHub. Không có khóa bí mật nào nằm trong website.

## Secrets cần tạo trên Cloudflare

Trong Worker **teresa-youth-choir** (hoặc tạo Worker mới `teresa-admin-api`) > **Settings** > **Variables and Secrets** > **Add** > **Encrypt**:

- `GITHUB_TOKEN`: GitHub fine-grained token, chỉ cấp repository `Duc-Syn29/teresa-youth-choir`, quyền **Contents: Read and write**.
- `FIREBASE_API_KEY`: `AIzaSyCg1OzlmS2ca6jmk09LUO-Rub2aU_Hfn6w`.
- `ADMIN_EMAIL`: `chanvcl10@gmail.com`.

Biến thường (không phải secret): `GITHUB_OWNER=Duc-Syn29`, `GITHUB_REPO=teresa-youth-choir`, `GITHUB_BRANCH=main`.

Sau đó dán nội dung `worker.js` vào Cloudflare Worker, bấm **Deploy**, bật workers.dev URL hoặc gắn domain `api.cadoangioitreteresa.org`. Cập nhật `endpoint` trong `js/firebase-config.js` nếu Worker có URL khác.
