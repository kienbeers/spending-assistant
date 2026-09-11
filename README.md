# Chi tiêu

Sổ chi tiêu cá nhân: nhập nhanh, phân tích dòng tiền, sổ nợ, ngân sách và trợ lý AI chạy local.
Chạy trên Jetson (`thinhhv@100.88.32.64`), dữ liệu trong `~/projects/chi-tieu/data/chi-tieu.db` (SQLite).

- **Mở app:** http://100.88.32.64:3005. Dùng được cả ở nhà lẫn bên ngoài, miễn điện thoại bật Tailscale.
- **Trên iPhone:** Safari → Chia sẻ → **Thêm vào MH chính**.

## Tính năng

| Trang | Làm gì |
|---|---|
| **Tổng quan** | Nhập nhanh, đã chi / thu trong tháng, chi theo ngày và danh mục |
| **Phân tích** | Thu – chi 3/6/12 tháng, tiền vào từ đâu, dòng tiền theo ví, khoản cố định và linh hoạt, chi tăng bất thường |
| **Sổ nợ** | Cho vay / đi vay, trả góp hằng tháng, sắp đến hạn / quá hạn, tài sản ròng |
| **Kế hoạch** | Ngân sách theo danh mục (theo trung bình, chép tháng trước, AI đề xuất), mục tiêu tiết kiệm, AI nhận xét và hỏi đáp |
| Giao dịch · Ví · Danh mục | Ở góc trên (điện thoại) |

Giao dịch nợ và chuyển ví **không tính vào thu/chi**, chỉ làm thay đổi số dư ví và số nợ.

## Nhập nhanh

| Gõ | Hiểu là |
|---|---|
| `35k cafe` · `ăn trưa 45k momo` · `4l đi chợ` | Chi, tự chọn danh mục và ví |
| `thanh toán tiền nhà 2.175m shb` | Chi 2.175.000đ từ SHB, danh mục Nhà ở |
| `lương 15tr shb` · `+500k bán đồ cũ` | Thu |
| `chuyển 500k mb sang momo` · `rút 2tr mb` | Chuyển ví |
| `cho Nam mượn 500k` · `Nam trả 200k` | Cho vay · thu nợ |
| `vay mẹ 5tr` · `trả nợ mẹ 1tr` · `trả góp xe 1tr2` | Đi vay · trả nợ |
| `hôm qua đổ xăng 80k` · `5/9 internet 250k` | Ghi vào ngày khác |

- **Số tiền theo quy ước:** `k` = nghìn, `l` = trăm nghìn, `m` = triệu. Ví dụ `2k` = 2.000, `4l` = 400.000,
  `2.175m` = 2.175.000, `15m` = 15.000.000. Vẫn nhận `1tr5`, `35.000`, `2 củ`, `2 trăm`; số trơn dưới 1000 hiểu là nghìn (`35` = 35.000).
- **Tên ví, tên khoản nợ và từ khóa danh mục:** sửa được trong app. App cũng tự học từ khóa khi bạn chọn danh mục cho ghi chú ngắn.

## AI

- **Mặc định:** Ollama chạy trên Jetson với model `qwen3:8b`, dùng GPU, dữ liệu không rời máy.
- **Cách AI dùng số liệu:** mọi con số (tổng, trung bình, dự kiến, nợ đến hạn) do code tính sẵn. AI chỉ viết nhận xét và đề xuất.
- **Ngân sách AI đề xuất:** code kiểm tra lại, giữ trong biên hợp lý quanh mức trung bình và không để vượt số tiền có thể chi.
- **Tốc độ:** nhận xét tháng khoảng 30 giây. Lần đầu sau khi Jetson khởi động mất thêm khoảng 1 phút để nạp model.

Cấu hình trong `~/projects/chi-tieu/.env.local` trên Jetson (không bắt buộc):

```bash
OLLAMA_MODEL=qwen3:8b           # model khác: ollama pull <tên>
# Đổi sang Claude (dữ liệu tổng hợp sẽ gửi lên Anthropic):
# AI_PROVIDER=anthropic
# ANTHROPIC_API_KEY=sk-ant-...
```

Sửa `.env.local` xong thì chạy `pm2 restart chi-tieu --update-env`.

## Phát triển

```bash
npm install
npm run dev      # http://localhost:3005 (dữ liệu local: data/chi-tieu.db)
npm test         # 46 test
npm run deploy   # đẩy code lên Jetson, build, khởi động lại (giữ nguyên dữ liệu và .env.local)
```

**Sao lưu:** chép file `data/chi-tieu.db` trên Jetson, ví dụ `scp thinhhv@100.88.32.64:projects/chi-tieu/data/chi-tieu.db .`
