# Quản trị nhật ký — bản cải tiến đến 15/10/2026

Bản phát hành 15/10/2026 dùng bucket R2 riêng `teresa-admin-private` (preview: `teresa-admin-private-preview`), giữ bucket này riêng tư và gắn binding `PRIVATE_BUCKET`; không bật tên miền công khai cho bucket quản trị. Chức năng đồng bộ, tài khoản, dung lượng, chống ảnh trùng và bảo vệ lịch sử cần triển khai Worker cùng giao diện. Nếu máy chủ chưa đúng phiên bản hoặc chưa có kho riêng, bản thử khóa thêm ảnh và đăng bài để tránh tác động website thật qua máy chủ cũ; vẫn cho chuẩn bị bản nháp trên máy và xem trước. Khi phát hành: tạo kho riêng và triển khai Worker trước, rồi cập nhật giao diện.

## Thêm hoặc sửa sự kiện

1. Chọn năm, mở **Sự kiện**, bấm **Thêm sự kiện** hoặc **Sửa**.
2. **Viết bài**: nhập tên, ngày và nội dung. Giới thiệu ngắn có thể để trống để lấy phần đầu bài. Xuống dòng để chia đoạn.
3. **Chọn ảnh**: chọn tệp hoặc kéo ảnh vào khung. Sửa chú thích; dùng nút ↑/↓ để đổi thứ tự. Chọn **Bìa sự kiện** hoặc **Bìa năm** trên ảnh có sẵn để tái sử dụng ảnh.
4. Trong **Ảnh trong nội dung bài viết**, mở đoạn cần minh họa và chọn ảnh. Tìm theo chú thích hoặc tên tệp, có thể gõ không dấu. Chỉ hiện 24 ảnh mỗi lần và có nút xem thêm. Lựa chọn được giữ khi lọc ảnh hoặc đổi trang. Tối đa 3 ảnh trong bài; mỗi ảnh chỉ chèn một lần. Các ảnh còn lại nằm trong album. Bỏ hết lựa chọn để bài chỉ có chữ và album.
5. **Xem trước & đăng**: mặc định xem điện thoại, có thể chuyển máy tính. Nút đăng sẽ thông báo số sự kiện thêm/sửa/gỡ trước khi xác nhận; đăng toàn bộ thay đổi của năm đang chọn. Sau khi gửi, trang kiểm tra dữ liệu công khai để báo website đã cập nhật hay vẫn chờ.

**Gỡ khỏi sự kiện** chỉ bỏ ảnh khỏi bài. **Xóa khỏi kho ảnh** là thao tác riêng của chủ quản trị và có kiểm tra tham chiếu.

## RAW và dung lượng R2

RAW được xử lý ngay trên thiết bị: lấy ảnh JPEG xem trước lớn nhất có sẵn trong tệp máy ảnh, giữ hướng ảnh rồi nén thành ảnh web. Đây là ảnh máy ảnh đã xử lý sẵn, không phải giải mã cảm biến RAW để chỉnh màu/phơi sáng. Tệp RAW không gửi lên R2.

Đã kiểm tra với CR2 của ca đoàn: năm mẫu có JPEG 5184 × 3456 px. Một mẫu xoay trái được thử trong Chrome thật, tạo thumbnail 22.244 byte và ảnh web 205.848 byte, tổng 228.092 byte. Không bảo đảm mọi máy ảnh/RAW có ảnh xem trước phù hợp. RAW thiếu JPEG lớn, bị hỏng hoặc lớn hơn 100 MB sẽ yêu cầu xuất JPG. JPG/PNG/WebP/AVIF giới hạn đầu vào 25 MB.

Ảnh mới lưu hai tệp: thumbnail tối đa 480 px và ảnh web tối đa 2048 px; bìa tải riêng tối đa 2560 px. Ảnh web dùng chung cho nội dung và xem lớn. Ưu tiên WebP, có JPEG dự phòng. Tệp đã tối ưu giống hệt trong cùng năm dùng chung khóa R2 theo nội dung; không ghi thêm bản sao khi đủ hai biến thể. Đổi kích thước/chất lượng hoặc trình duyệt tạo byte khác có thể tạo bộ ảnh khác.

Thông báo tải ảnh cho biết dung lượng đầu vào và tổng ảnh tối ưu. **Kho ảnh → Xem dung lượng** tính số tệp/biến thể và dung lượng thực tế của năm, không nhầm số tệp với số ảnh độc lập.

## Bản nháp và tài khoản

Bản nháp lưu trên máy trước rồi đồng bộ vào bucket quản trị riêng trong R2 khi Worker hỗ trợ. Trạng thái phân biệt đã đồng bộ và chỉ lưu trên máy. Phiên bản được kiểm tra để hai thiết bị không ghi đè im lặng. Nếu xung đột, bản cục bộ được giữ và báo đối chiếu; có màn đối chiếu để chọn bản cần giữ cho từng mục khác nhau. Với mỗi sự kiện, lựa chọn giữ nguyên cả nội dung và ảnh của sự kiện đó; không tự trộn câu văn. Hai bản được lưu vào lịch sử trên thiết bị trước khi kết hợp, giữ tối đa 12 bản khôi phục/năm. Nếu không lưu được bản dự phòng thì dừng kết hợp.

Chủ quản trị mở **Kiểm tra & lịch sử → Người quản trị** để tạo tài khoản email/mật khẩu riêng hoặc cấp quyền cho tài khoản Firebase đã có. Người biên tập có thể viết, tải ảnh, xem trước và đăng bài; không được quản lý tài khoản hoặc xóa ảnh khỏi kho. Gỡ quyền sẽ có hiệu lực ở yêu cầu API tiếp theo. Mật khẩu không lưu vào dữ liệu/R2 và không gửi email tự động.

Tài khoản chủ quản trị vẫn cấu hình ở secrets ADMIN_UIDS/ADMIN_EMAIL(S). Nếu có người biên tập cấp qua secrets EDITOR_UIDS/EDITOR_EMAILS, việc thu hồi người đó phải cập nhật secrets, vì danh sách trên giao diện quản lý quyền đã cấp qua giao diện.

API Firebase dùng theo tài liệu chính thức: https://firebase.google.com/docs/reference/rest/auth#section-create-email-password

## Xóa ảnh và lịch sử

Worker kiểm tra dữ liệu đang công khai, bản nháp đồng bộ và các ảnh trong lịch sử 30 ngày tạo bởi bản Worker mới trước khi cho xóa ảnh. Lịch sử này được ghi ở mỗi lần đăng từ khi triển khai, không tự nhập toàn bộ lịch sử cũ. Xóa ảnh khỏi kho vẫn đi qua cơ chế thùng rác hiện có. Chưa bật tự động xóa hàng loạt, chưa xóa ảnh hay lịch sử thật trong lần sửa này.

Ban điều hành chỉ nhập tên và ghi chú; không còn nút tải ảnh. Dữ liệu ảnh cũ được giữ.

## Kiểm tra

Dữ liệu 12 năm/114 sự kiện/107 album không thay đổi. Kiểm tra tự động gồm RAW lỗi/thumbnail nhỏ, khóa bản nháp, quyền người biên tập, thu hồi tài khoản, tái sử dụng ảnh trùng và ảnh được chọn ngoài ba ảnh đầu album. Chrome mô phỏng 320/390/1440 px đã kiểm tra luồng bài, chú thích, thứ tự, chèn ảnh, bìa, đồng bộ và xem trước điện thoại; chưa thử trên iPhone vật lý.


## Tải ảnh lỗi và gián đoạn

Mỗi lượt tải có danh sách tên tệp và trạng thái thành công, lỗi hoặc đã dừng. Một ảnh lỗi không làm dừng cả album. **Thử lại ảnh lỗi / chưa tải** chỉ gửi những ảnh chưa thành công của lượt đó. Hàng đợi cũ được giữ khi thêm một lượt mới trong cùng phiên; phải mở đúng năm/sự kiện để thử lại. Trong lúc lưu chuẩn bị và tải ảnh, các thao tác sửa được khóa để giữ đúng nội dung.

Yêu cầu mạng bị treo sẽ dừng sau tối đa hai phút và báo thử lại. Nút dừng hàng đợi chờ ảnh hiện tại hoàn tất/timeout. Tệp nguồn của hàng đợi chỉ được giữ trong bộ nhớ phiên trang, không tải RAW lên R2 và không lưu RAW vào bản nháp. Sau khi đóng/tải lại trang, cần chọn lại tệp chưa thành công; ảnh đã thêm vẫn ở bản nháp.

## Bài cần hoàn thiện và hướng dẫn

Trong **Sự kiện**, mở danh sách cần kiểm tra để thấy bài thiếu tên/ngày/nội dung/bìa/ảnh hoặc chưa xem trước. Thiếu bìa/ảnh là gợi ý, không buộc mượn ảnh không liên quan. Dấu xem trước chỉ áp dụng phiên hiện tại và hết hiệu lực khi nội dung sự kiện thay đổi.

**Hướng dẫn nhanh & bài mẫu** tạo bài THỰC HÀNH trong bản nháp. Giao diện và Worker đều chặn đăng bài còn cờ thực hành. Phải thay tên và nội dung mẫu trước khi đánh dấu đã đổi thành bài thật, hoặc gỡ bài mẫu.

## Dung lượng theo sự kiện và thùng rác

Kho ảnh có bảng dung lượng năm và từng sự kiện, phân biệt bộ ảnh độc lập, tệp/biến thể và byte thực tế. Ảnh dùng chung có thể được tính trong nhiều dòng sự kiện, nhưng tổng của năm chỉ tính mỗi tệp một lần; không cộng các dòng sự kiện để ra dung lượng R2. Ảnh ngoài kho năm đang chọn được ghi là chưa tính, thay vì khẳng định dung lượng bằng 0.

**Xóa khỏi kho ảnh** mở màn xem trước ảnh, số biến thể/dung lượng và nơi còn sử dụng: dữ liệu công khai, bản nháp trên máy/đồng bộ, lịch sử đang giữ. Có tham chiếu thì khóa nút xóa. Không tự gỡ nội dung khỏi bài để cho phép xóa. Máy chủ kiểm tra lại ở thời điểm xóa.

**Xem thùng rác** hiển thị ảnh nhỏ, ngày gỡ và hạn giữ tối thiểu 30 ngày. Ảnh xem trước yêu cầu đăng nhập chủ quản trị, không mở công khai. Khôi phục trả các biến thể về đường dẫn cũ và gỡ bản sao thùng rác sau khi hoàn tất; không ghi đè ảnh khác đang tồn tại. Ảnh được trả vào kho, không tự chèn lại vào bài. Hiện chưa bật tự xóa ảnh quá hạn hoặc xóa hàng loạt.

Để giảm dung lượng kho riêng, lịch sử bảo vệ ảnh chỉ giữ danh sách nhóm ảnh được tham chiếu, không sao chép byte ảnh hay toàn bộ bài viết. Khi đối chiếu, ảnh của cả hai bản được giữ tham chiếu 30 ngày để tránh xóa nhầm ảnh cần khôi phục. Nội dung đã đăng vẫn nằm trong lịch sử GitHub; hai bản trước đối chiếu nằm trong lịch sử trên thiết bị.

Kiểm tra bổ sung: tìm ảnh/phân trang, giữ lựa chọn khi lọc, tải lại riêng ảnh bị lỗi mạng, đối chiếu bản nháp, chặn đăng bài mẫu, xem trước khi xóa, khôi phục thùng rác và bảng dung lượng chạy ở Chrome 320/390/1440 px với API giả lập. Không thao tác xóa/tải ảnh, tạo tài khoản hay đăng bài trên website/R2 thật trong phiên này.

## Căn bìa và dùng lại ảnh giữa các năm

Trong **Giới thiệu năm** hoặc bước **Chọn ảnh** của sự kiện, dùng bốn thanh căn khung để đặt trọng tâm riêng cho máy tính và điện thoại. Hai khung xem trước dùng cùng URL ảnh; chỉ tọa độ được lưu trong bản nháp.

Trong **Kho ảnh**, chọn **Năm lưu ảnh**, mở ảnh và bấm **Dùng lại trong sự kiện** sau khi chọn một sự kiện cần sửa. Ảnh giữ nguyên URL/biến thể ở năm nguồn, không sao chép lên R2. Chỉ mục `data/media-usage.json` bảo vệ ảnh đang dùng trong album của năm khác; Worker cập nhật chỉ mục cùng commit xuất bản. Nếu sửa JSON thủ công, chạy `npm run index:media`.

Ảnh mới nén với mục tiêu thumbnail 60 KiB, ảnh bài 350 KiB, bìa 500 KiB; chất lượng giảm có giới hạn tới .70, không giảm kích thước tiếp chỉ để ép dung lượng. Ảnh nhiều chi tiết có thể vượt mục tiêu nhằm giữ độ rõ.

## Giao diện công khai

Nội dung được căn đều hai lề trên điện thoại và máy tính. Tìm kỷ niệm ở trang chủ dùng chỉ mục JSON, không tải ảnh kết quả. Có tùy chọn tiết kiệm dữ liệu ảnh ở chân trang; chế độ này dừng tự tải thêm/tải trước và có nút mở bản nét. Ảnh lớn giữ ảnh xem trước tới khi giải mã xong, hỗ trợ kéo khi phóng và pinch trên màn hình cảm ứng.

`npm run build` tạo 126 trang đầu năm/sự kiện trong `.site/`, kèm ảnh bìa preload và dữ liệu năm nhúng sẵn; đường dẫn cũ vẫn hoạt động. Cloudflare Pages dùng build command `npm run build`, output `.site`. Không tạo thêm ảnh R2 trong bước build.

## Giảm thời gian chờ khi mở và sửa bài

API năm dạng gọn giữ manifest album; ảnh đầy đủ của một sự kiện chỉ tải khi mở bước Chọn ảnh, ghim theo commit cơ sở của bản nháp. Chỉ dựng 24 thẻ ảnh mỗi đợt; mọi ảnh còn lại vẫn được giữ khi lưu bài. Chọn sự kiện luôn trở về bước Viết bài.

Lịch sử và kho ảnh tải khi mở đúng mục. Năm đã đọc được dùng lại tối đa 60 giây; bỏ thay đổi/tải lại luôn đọc bản mới. Tự lưu trên thiết bị sau 700 ms ngừng nhập, đồng bộ sau khoảng 3,5 giây rảnh và không khóa điều hướng; nút Lưu bản nháp vẫn chờ đồng bộ. Xác nhận đồng bộ cũ không được ghi đè nội dung mới đang gõ. Phông chữ tải không chặn hiển thị.

Đối chiếu JSON chưa nén: năm 2025 từ 21 lượt đọc GitHub/564.869 byte xuống 2 lượt/149.309 byte; năm 2026 từ 13 lượt/360.472 byte xuống 2 lượt/69.425 byte. Chưa gồm đăng nhập và bản nháp. Cùng sự kiện 65 ảnh, phép thử trình duyệt cho bước viết giảm từ 65 thẻ xuống 0, thời gian dựng từ 10,5 ms xuống 3,2 ms trên máy thử. Bước ảnh dựng 24/65 thẻ, lưu vẫn đủ 65 ảnh. Phép thử quản trị dùng API giả lập, không đăng bài hoặc ảnh thật.

## Quản trị dễ dùng và chọn tối đa 50 ảnh (16/10/2026)

Đầu trang có ba nút **Thêm sự kiện**, **Sửa bài đã có**, **Tiếp tục bản nháp**. Nút tiếp tục mở sự kiện sửa gần nhất trên thiết bị của năm đang chọn. Mặc định mở năm hiện tại nếu có dữ liệu, nếu chưa có thì mở năm mới nhất.

Chọn 20–40 ảnh tiêu biểu, tối đa 50 ảnh trong album mỗi sự kiện, tính cả ảnh đã có. Khi chọn tệp, màn duyệt ảnh mở trước khi tải: có ảnh nhỏ, tên, dung lượng nguồn, nút bỏ/chọn và phân trang 24 ảnh. Nếu chọn nhiều hơn số chỗ còn lại, ban đầu chưa chọn ảnh nào; tự chọn những ảnh cần giữ. Hệ thống không tự bỏ ảnh. Tệp giống hệt nhau trong lượt chọn được loại trước khi tải. Ảnh gần giống trong các trang đã xem có gợi ý theo hình thu nhỏ để tự cân nhắc; đây chỉ là gợi ý, không tự bỏ chọn. Không tự đánh giá ảnh mờ hay đúng ngữ cảnh.

Sau xác nhận, ảnh được tối ưu rồi tải lần lượt. Kết quả báo số ảnh thành công/lỗi và dung lượng lưu thêm trên R2 so với tệp nguồn. RAW không tải lên. Các giới hạn chất lượng và hai biến thể ở phần RAW phía trên tiếp tục áp dụng. Album cũ trên 50 ảnh được giữ, được sửa chữ/chú thích hoặc giảm ảnh; muốn thêm ảnh mới phải giảm album về giới hạn. Giao diện chặn tải/dùng lại thêm ảnh khi đủ 50; Worker kiểm tra lại khi xuất bản. Bìa riêng vẫn có thể thay; nên chọn bìa từ ảnh trong album để dùng chung tệp.

## Chia sẻ, SEO, CSS và ngoại tuyến

Build tạo OG/Twitter, canonical riêng và dữ liệu có cấu trúc Article/CollectionPage cho 126 trang năm/sự kiện; sitemap chỉ chứa trang công khai. Trang quản trị và xem trước đặt noindex. Mã escapeHTML dùng chung trong public-tools; các khung thành viên/căn bìa và bộ chọn ảnh được tách khỏi admin.js.

`npm run build` tạo ba stylesheet theo nhóm trang từ style.css, giữ nguyên thứ tự khai báo trong từng trang. Sửa style.css rồi chạy build để cập nhật home.css/archive.css/admin-base.css; admin.css vẫn là phần quản trị riêng.

Service Worker lưu giới hạn 90 tài nguyên cùng nguồn trên thiết bị. HTML/dữ liệu luôn ưu tiên mạng và chỉ dùng bản đã lưu khi mất kết nối; CSS/JS có phiên bản được dùng lại từ cache. Không lưu R2/ảnh ngoài nguồn, yêu cầu xác thực, API, trang quản trị hoặc xem trước. Ảnh vẫn theo bộ nhớ đệm thông thường của trình duyệt; không hứa tải được toàn bộ album ngoại tuyến. Nội dung chưa từng đọc có màn hướng dẫn kết nối lại. Cache được đổi phiên bản theo nội dung build, không tạo thêm tệp R2.

Tham khảo triển khai: [MDN Service Workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers) và [Google Article structured data](https://developers.google.com/search/docs/appearance/structured-data/article).
