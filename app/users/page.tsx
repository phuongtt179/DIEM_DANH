'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { UserCog, Plus, X, Edit2, Trash2, Eye, EyeOff } from 'lucide-react';

interface AppUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'teacher' | 'treasurer';
  created_at: string;
}

interface ClassItem {
  id: string;
  name: string;
}

interface TeacherClass {
  class_id: string;
  classes: { name: string };
}

const roleLabels: { [key: string]: string } = {
  admin: 'Quản trị viên',
  teacher: 'Giáo viên',
  treasurer: 'Thủ quỹ',
};

const roleColors: { [key: string]: string } = {
  admin: 'bg-purple-100 text-purple-700',
  teacher: 'bg-blue-100 text-blue-700',
  treasurer: 'bg-green-100 text-green-700',
};

export default function UsersPage() {
  const { user, hasPermission } = useAuth();
  const router = useRouter();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<AppUser | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [teacherClasses, setTeacherClasses] = useState<string[]>([]);
  const [form, setForm] = useState({
    email: '',
    name: '',
    role: 'teacher' as 'admin' | 'teacher' | 'treasurer',
    password: '',
  });

  // Check permission
  useEffect(() => {
    if (!hasPermission('manage_users')) {
      router.push('/');
    }
  }, [hasPermission, router]);

  useEffect(() => {
    loadUsers();
    loadClasses();
  }, []);

  async function loadUsers() {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('app_users')
        .select('id, email, name, role, created_at')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setUsers(data || []);
    } catch (error) {
      console.error('Error loading users:', error);
    } finally {
      setLoading(false);
    }
  }

  async function loadClasses() {
    try {
      const { data, error } = await supabase
        .from('classes')
        .select('id, name')
        .order('name');

      if (error) throw error;
      setClasses(data || []);
    } catch (error) {
      console.error('Error loading classes:', error);
    }
  }

  async function loadTeacherClasses(userId: string) {
    try {
      const { data, error } = await supabase
        .from('teacher_classes')
        .select('class_id')
        .eq('user_id', userId);

      if (error) throw error;
      setTeacherClasses((data || []).map((tc: any) => tc.class_id));
    } catch (error) {
      console.error('Error loading teacher classes:', error);
      setTeacherClasses([]);
    }
  }

  function openCreateModal() {
    setEditingUser(null);
    setForm({ email: '', name: '', role: 'teacher', password: '' });
    setTeacherClasses([]);
    setShowPassword(false);
    setShowModal(true);
  }

  async function openEditModal(userItem: AppUser) {
    setEditingUser(userItem);
    setForm({
      email: userItem.email,
      name: userItem.name,
      role: userItem.role,
      password: '',
    });
    setShowPassword(false);
    if (userItem.role === 'teacher') {
      await loadTeacherClasses(userItem.id);
    } else {
      setTeacherClasses([]);
    }
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setEditingUser(null);
    setForm({ email: '', name: '', role: 'teacher', password: '' });
    setTeacherClasses([]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    try {
      if (editingUser) {
        // Update existing user
        const updateData: any = {
          email: form.email.toLowerCase().trim(),
          name: form.name.trim(),
          role: form.role,
          updated_at: new Date().toISOString(),
        };

        // Only update password if provided
        if (form.password) {
          updateData.password_hash = form.password;
        }

        const { error } = await supabase
          .from('app_users')
          .update(updateData)
          .eq('id', editingUser.id);

        if (error) throw error;

        // Update teacher classes if role is teacher
        if (form.role === 'teacher') {
          // Delete existing assignments
          await supabase
            .from('teacher_classes')
            .delete()
            .eq('user_id', editingUser.id);

          // Insert new assignments
          if (teacherClasses.length > 0) {
            const assignments = teacherClasses.map(classId => ({
              user_id: editingUser.id,
              class_id: classId,
            }));

            await supabase
              .from('teacher_classes')
              .insert(assignments);
          }
        }

        alert('Cập nhật người dùng thành công!');
      } else {
        // Create new user
        if (!form.password) {
          alert('Vui lòng nhập mật khẩu');
          setSaving(false);
          return;
        }

        const { data, error } = await supabase
          .from('app_users')
          .insert([{
            email: form.email.toLowerCase().trim(),
            name: form.name.trim(),
            role: form.role,
            password_hash: form.password,
          }])
          .select()
          .single();

        if (error) {
          if (error.code === '23505') {
            alert('Email đã tồn tại!');
            setSaving(false);
            return;
          }
          throw error;
        }

        // Add teacher classes if role is teacher
        if (form.role === 'teacher' && teacherClasses.length > 0 && data) {
          const assignments = teacherClasses.map(classId => ({
            user_id: data.id,
            class_id: classId,
          }));

          await supabase
            .from('teacher_classes')
            .insert(assignments);
        }

        alert('Tạo người dùng thành công!');
      }

      closeModal();
      loadUsers();
    } catch (error) {
      console.error('Error saving user:', error);
      alert('Có lỗi xảy ra, vui lòng thử lại');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(userItem: AppUser) {
    // Don't allow deleting yourself
    if (userItem.id === user?.id) {
      alert('Không thể xóa tài khoản của chính mình!');
      return;
    }

    const confirmed = window.confirm(`Bạn có chắc muốn xóa người dùng "${userItem.name}"?`);
    if (!confirmed) return;

    try {
      const { error } = await supabase
        .from('app_users')
        .delete()
        .eq('id', userItem.id);

      if (error) throw error;
      alert('Đã xóa người dùng!');
      loadUsers();
    } catch (error) {
      console.error('Error deleting user:', error);
      alert('Có lỗi xảy ra, vui lòng thử lại');
    }
  }

  function toggleTeacherClass(classId: string) {
    setTeacherClasses(prev =>
      prev.includes(classId)
        ? prev.filter(id => id !== classId)
        : [...prev, classId]
    );
  }

  if (!hasPermission('manage_users')) {
    return null;
  }

  return (
    <div className="p-4 lg:p-8">
      <div className="mb-6 lg:mb-8 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-gray-800">Quản lý Người dùng</h1>
          <p className="text-sm lg:text-base text-gray-600 mt-1">Tạo và phân quyền tài khoản</p>
        </div>
        <button
          onClick={openCreateModal}
          className="flex items-center justify-center gap-2 px-4 lg:px-6 py-2 lg:py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold text-sm lg:text-base"
        >
          <Plus size={20} />
          Thêm người dùng
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center items-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      ) : users.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg shadow">
          <UserCog className="mx-auto text-gray-300 mb-4" size={48} />
          <p className="text-gray-500">Chưa có người dùng nào</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b-2 border-gray-200">
              <tr>
                <th className="px-3 lg:px-6 py-2 lg:py-3 text-left text-xs lg:text-sm font-bold text-gray-700">STT</th>
                <th className="px-3 lg:px-6 py-2 lg:py-3 text-left text-xs lg:text-sm font-bold text-gray-700">Tên</th>
                <th className="px-3 lg:px-6 py-2 lg:py-3 text-left text-xs lg:text-sm font-bold text-gray-700">Email</th>
                <th className="px-3 lg:px-6 py-2 lg:py-3 text-center text-xs lg:text-sm font-bold text-gray-700">Vai trò</th>
                <th className="px-3 lg:px-6 py-2 lg:py-3 text-center text-xs lg:text-sm font-bold text-gray-700">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {users.map((userItem, index) => (
                <tr key={userItem.id} className="hover:bg-gray-50">
                  <td className="px-3 lg:px-6 py-2 lg:py-3 text-xs lg:text-base text-gray-600">{index + 1}</td>
                  <td className="px-3 lg:px-6 py-2 lg:py-3 text-xs lg:text-base font-semibold text-gray-800">
                    {userItem.name}
                    {userItem.id === user?.id && (
                      <span className="ml-2 text-xs text-blue-600">(Bạn)</span>
                    )}
                  </td>
                  <td className="px-3 lg:px-6 py-2 lg:py-3 text-xs lg:text-base text-gray-600">{userItem.email}</td>
                  <td className="px-3 lg:px-6 py-2 lg:py-3 text-center">
                    <span className={`px-2 lg:px-3 py-1 rounded-full text-xs lg:text-sm font-semibold ${roleColors[userItem.role]}`}>
                      {roleLabels[userItem.role]}
                    </span>
                  </td>
                  <td className="px-3 lg:px-6 py-2 lg:py-3 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={() => openEditModal(userItem)}
                        className="p-1 lg:p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        title="Sửa"
                      >
                        <Edit2 size={18} />
                      </button>
                      {userItem.id !== user?.id && (
                        <button
                          onClick={() => handleDelete(userItem)}
                          className="p-1 lg:p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Xóa"
                        >
                          <Trash2 size={18} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* User Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center p-4 lg:p-6 border-b sticky top-0 bg-white">
              <h2 className="text-lg lg:text-2xl font-bold text-gray-800">
                {editingUser ? 'Sửa người dùng' : 'Thêm người dùng'}
              </h2>
              <button
                onClick={closeModal}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-4 lg:p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Họ và tên <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 lg:px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none text-sm lg:text-base"
                  placeholder="VD: Nguyễn Văn A"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Email <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="w-full px-3 lg:px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none text-sm lg:text-base"
                  placeholder="VD: email@example.com"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Mật khẩu {!editingUser && <span className="text-red-500">*</span>}
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required={!editingUser}
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    className="w-full px-3 lg:px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none text-sm lg:text-base pr-12"
                    placeholder={editingUser ? 'Để trống nếu không đổi' : 'Nhập mật khẩu'}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700"
                  >
                    {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Vai trò <span className="text-red-500">*</span>
                </label>
                <select
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value as 'admin' | 'teacher' | 'treasurer' })}
                  className="w-full px-3 lg:px-4 py-2 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none text-sm lg:text-base"
                >
                  <option value="teacher">Giáo viên</option>
                  <option value="treasurer">Thủ quỹ</option>
                  <option value="admin">Quản trị viên</option>
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  {form.role === 'admin' && 'Toàn quyền quản lý hệ thống'}
                  {form.role === 'teacher' && 'Điểm danh và xem thống kê lớp được phân công'}
                  {form.role === 'treasurer' && 'Xem điểm danh, thống kê và quản lý học phí'}
                </p>
              </div>

              {form.role === 'teacher' && classes.length > 0 && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Lớp phụ trách
                  </label>
                  <div className="border-2 border-gray-200 rounded-lg p-3 max-h-40 overflow-y-auto">
                    {classes.map((classItem) => (
                      <label
                        key={classItem.id}
                        className="flex items-center gap-2 py-1 cursor-pointer hover:bg-gray-50 px-2 rounded"
                      >
                        <input
                          type="checkbox"
                          checked={teacherClasses.includes(classItem.id)}
                          onChange={() => toggleTeacherClass(classItem.id)}
                          className="w-4 h-4 text-blue-600 rounded"
                        />
                        <span className="text-sm">{classItem.name}</span>
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Đã chọn: {teacherClasses.length} lớp
                  </p>
                </div>
              )}

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 px-4 lg:px-6 py-2 lg:py-3 border-2 border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-semibold text-sm lg:text-base"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 px-4 lg:px-6 py-2 lg:py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold disabled:bg-gray-300 text-sm lg:text-base"
                >
                  {saving ? 'Đang lưu...' : editingUser ? 'Cập nhật' : 'Tạo mới'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
