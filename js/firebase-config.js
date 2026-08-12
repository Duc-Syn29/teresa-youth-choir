/* Cấu hình kết nối Đám mây cho Teresa Youth Choir (Firebase & Cloudflare R2)
 * 
 * HƯỚNG DẪN:
 * 1. Đăng nhập vào Firebase Console: https://console.firebase.google.com/
 * 2. Tạo dự án (Project) -> Vào Project Settings ⚙️ -> Phần "Your apps" -> Tạo ứng dụng Web (</>)
 * 3. Thay thế các giá trị bên dưới bằng cấu hình từ Firebase Console của bạn.
 */

window.FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "teresa-youth-choir.firebaseapp.com",
  projectId: "teresa-youth-choir",
  storageBucket: "teresa-youth-choir.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

/* Cấu hình Cloudflare R2 (Lưu trữ Hình ảnh Miễn phí 10GB - 0$ Phí Băng thông)
 * 
 * HƯỚNG DẪN:
 * 1. Đăng nhập Cloudflare Dashboard -> Vào mục R2 -> Tạo Bucket (ví dụ: teresa-gallery)
 * 2. Bật Public Access cho Bucket hoặc gắn tên miền Custom Domain (ví dụ: https://pub-xxx.r2.dev)
 * 3. Nếu sử dụng Cloudflare Worker để tải ảnh lên, điền uploadEndpoint bên dưới.
 */
window.CLOUDFLARE_R2_CONFIG = {
  uploadEndpoint: "", // Ví dụ: "https://teresa-r2-upload.your-subdomain.workers.dev/upload"
  publicDomain: ""    // Ví dụ: "https://pub-xxx.r2.dev"
};
