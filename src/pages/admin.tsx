import { DashboardLayout } from '@/components/foundry-ui/dashboard/DashboardLayout';
import { AdminDashboard } from '@/components/admin/AdminDashboard';

const Admin = () => {
  return (
    <DashboardLayout>
      <AdminDashboard />
    </DashboardLayout>
  );
};

export default Admin;
