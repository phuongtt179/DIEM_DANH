# Các lệnh thường dùng

## 1. Chạy Server Development

```bash
# Chạy server trên cổng 3000
npm run dev
```

Server sẽ chạy tại: http://localhost:3000

## 2. Kill Server / Tắt Server

### Windows (PowerShell)
```powershell
# Tắt tất cả process Node.js
Get-Process -Name node -ErrorAction SilentlyContinue | Stop-Process -Force
```

### Windows (CMD)
```cmd
# Tắt tất cả process Node.js
taskkill /F /IM node.exe
```

### Tắt theo cổng cụ thể (PowerShell)
```powershell
# Tìm process đang dùng cổng 3000
netstat -ano | findstr :3000

# Tắt process theo PID (thay 12345 bằng PID thực tế)
taskkill /F /PID 12345
```

## 3. Git - Lưu thay đổi (Commit)

```bash
# Xem trạng thái các file đã thay đổi
git status

# Xem chi tiết thay đổi
git diff

# Thêm file vào staging
git add <tên-file>           # Thêm 1 file cụ thể
git add .                     # Thêm tất cả file

# Commit với message
git commit -m "Mô tả thay đổi"
```

## 4. Git - Đẩy lên Remote (Push)

```bash
# Đẩy code lên GitHub (Vercel sẽ tự động deploy)
git push

# Đẩy lên branch cụ thể
git push origin main
```

## 5. Git - Các lệnh khác

```bash
# Xem lịch sử commit
git log --oneline -10

# Lấy code mới nhất từ remote
git pull

# Khôi phục về commit cũ
git reset --hard <commit-hash>

# Tạo branch mới
git checkout -b <tên-branch>

# Chuyển branch
git checkout <tên-branch>
```

## 6. Quy trình đẩy code lên Vercel

```bash
# Bước 1: Kiểm tra trạng thái
git status

# Bước 2: Thêm các file đã thay đổi
git add .

# Bước 3: Commit với mô tả
git commit -m "Mô tả thay đổi"

# Bước 4: Push lên GitHub
git push

# Vercel sẽ tự động detect và deploy
```

## 7. Build Production

```bash
# Build ứng dụng cho production
npm run build

# Chạy bản build production
npm start
```

## 8. Cài đặt Dependencies

```bash
# Cài đặt tất cả packages
npm install

# Cài đặt package mới
npm install <tên-package>
```
