import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Trash2, FolderOpen, Lock } from 'lucide-react';
import { projectsApi } from '../api/projects';
import type { Project } from '../api/types';
import { Card, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { Spinner } from '../components/ui/Spinner';
import { toast } from '../components/layout/DashboardLayout';
import { ApiError } from '../api/client';
import { usePlanLimits } from '../context/UserConfigContext';

export function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editProject, setEditProject] = useState<Project | null>(null);
  const [deleteProject, setDeleteProject] = useState<Project | null>(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState('');
  const limits = usePlanLimits();
  const atLimit = !loading && projects.length >= limits.maxProjects;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await projectsApi.list();
      setProjects(data);
    } catch {
      toast('Failed to load projects', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setName('');
    setNameError('');
    setCreateOpen(true);
  };

  const openEdit = (p: Project) => {
    setEditProject(p);
    setName(p.name);
    setNameError('');
  };

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) { setNameError('Name is required'); return; }
    if (trimmed.length < 2) { setNameError('Name must be at least 2 characters'); return; }
    setSaving(true);
    try {
      if (editProject) {
        const updated = await projectsApi.update(editProject.id, trimmed);
        setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
        setEditProject(null);
        toast('Project updated', 'success');
      } else {
        const created = await projectsApi.create(trimmed);
        setProjects((prev) => [created, ...prev]);
        setCreateOpen(false);
        toast('Project created', 'success');
      }
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteProject) return;
    setSaving(true);
    try {
      await projectsApi.delete(deleteProject.id);
      setProjects((prev) => prev.filter((p) => p.id !== deleteProject.id));
      setDeleteProject(null);
      toast('Project deleted', 'success');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Delete failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (s: string) =>
    new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Projects</h1>
          <p className="text-sm text-gray-500 mt-0.5">Organize your quizzes into projects</p>
        </div>
        <div className="flex items-center gap-3">
          {atLimit && (
            <span className="flex items-center gap-1 text-xs text-amber-600 font-medium">
              <Lock className="w-3.5 h-3.5" />
              {projects.length}/{limits.maxProjects} projects
            </span>
          )}
          <Button icon={<Plus className="w-4 h-4" />} onClick={openCreate} disabled={atLimit}>
            New project
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : projects.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center justify-center py-14 text-center">
            <div className="w-14 h-14 bg-blue-50 rounded-2xl flex items-center justify-center mb-4">
              <FolderOpen className="w-7 h-7 text-blue-500" />
            </div>
            <p className="text-base font-semibold text-gray-800">No projects yet</p>
            <p className="text-sm text-gray-400 mt-1 mb-5">Projects group your quizzes. Create one to get started.</p>
            <Button icon={<Plus className="w-4 h-4" />} onClick={openCreate}>
              Create your first project
            </Button>
          </div>
        </Card>
      ) : (
        <div className="grid gap-3">
          {projects.map((p) => (
            <Card key={p.id} className="hover:border-blue-200 transition-colors">
              <div className="flex items-center gap-4">
                <div className="w-9 h-9 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0">
                  <FolderOpen className="w-4.5 h-4.5 text-blue-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900">{p.name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">Created {formatDate(p.created_at)}</p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Pencil className="w-3.5 h-3.5" />}
                    onClick={() => openEdit(p)}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Trash2 className="w-3.5 h-3.5 text-red-500" />}
                    onClick={() => setDeleteProject(p)}
                    className="text-red-500 hover:bg-red-50"
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New project" size="sm">
        <div className="flex flex-col gap-4">
          <Input
            label="Project name"
            value={name}
            onChange={(e) => { setName(e.target.value); setNameError(''); }}
            placeholder="My Quiz Project"
            error={nameError}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} loading={saving}>Create</Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!editProject} onClose={() => setEditProject(null)} title="Edit project" size="sm">
        <div className="flex flex-col gap-4">
          <Input
            label="Project name"
            value={name}
            onChange={(e) => { setName(e.target.value); setNameError(''); }}
            placeholder="My Quiz Project"
            error={nameError}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditProject(null)}>Cancel</Button>
            <Button onClick={handleSave} loading={saving}>Save</Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteProject}
        onClose={() => setDeleteProject(null)}
        onConfirm={handleDelete}
        title="Delete project"
        message={`Delete "${deleteProject?.name}"? All associated quizzes will also be deleted.`}
        confirmLabel="Delete"
        loading={saving}
      />
    </div>
  );
}
