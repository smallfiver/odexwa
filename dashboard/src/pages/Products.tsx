import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Plus,
  Edit,
  Trash2,
  Loader2,
  X,
  Package,
  Check,
  AlertTriangle,
  AlertCircle,
  Copy,
  Send,
  Upload,
  ChevronUp,
  ChevronDown,
  FileText,
  Image as ImageIcon,
  Video,
  File as FileIcon,
} from 'lucide-react';
import {
  API_BASE_URL,
  FUNNEL_STEP_TYPES,
  type Product,
  type FunnelStepInput,
  type FunnelStepType,
} from '../services/api';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useRole } from '../hooks/useRole';
import {
  useProductsQuery,
  useSessionsQuery,
  useCreateProductMutation,
  useUpdateProductMutation,
  useDeleteProductMutation,
  useUploadMediaMutation,
  useTestFunnelMutation,
} from '../hooks/queries';
import { PageHeader } from '../components/PageHeader';
import './Products.css';

// Draft shape for the create/edit modal. Media steps hold the server path returned by the upload
// endpoint plus the original filename/mimetype so the row can show what was attached.
interface StepDraft {
  type: FunnelStepType;
  delayMinutes: number;
  text: string;
  mediaPath?: string;
  mediaFilename?: string;
  mediaMimetype?: string;
}

interface ProductDraft {
  id: string | null;
  name: string;
  sessionId: string;
  active: boolean;
  steps: StepDraft[];
}

const emptyDraft = (sessionId = ''): ProductDraft => ({
  id: null,
  name: '',
  sessionId,
  active: true,
  steps: [{ type: 'text', delayMinutes: 0, text: '' }],
});

const stepIcon = (type: FunnelStepType, size = 16) => {
  switch (type) {
    case 'image':
      return <ImageIcon size={size} />;
    case 'video':
      return <Video size={size} />;
    case 'document':
      return <FileIcon size={size} />;
    default:
      return <FileText size={size} />;
  }
};

export function Products() {
  const { t } = useTranslation();
  useDocumentTitle(t('products.title'));
  const { canWrite } = useRole();
  const { data: products = [], isLoading, isError } = useProductsQuery();
  const { data: sessions = [] } = useSessionsQuery();
  const createMutation = useCreateProductMutation();
  const updateMutation = useUpdateProductMutation();
  const deleteMutation = useDeleteProductMutation();
  const uploadMutation = useUploadMediaMutation();
  const testMutation = useTestFunnelMutation();

  const [draft, setDraft] = useState<ProductDraft | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [testTarget, setTestTarget] = useState<Product | null>(null);
  const [testPhone, setTestPhone] = useState('');
  const [uploadingStep, setUploadingStep] = useState<number | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  useEffect(() => {
    if (copied) {
      const timer = setTimeout(() => setCopied(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [copied]);

  const sessionName = (id: string) => sessions.find(s => s.id === id)?.name || id.substring(0, 12);

  const webhookUrls = (token: string) => ({
    perfectpay: `${API_BASE_URL}/webhooks/produtos/${token}/perfectpay`,
    kirvano: `${API_BASE_URL}/webhooks/produtos/${token}/kirvano`,
    generico: `${API_BASE_URL}/webhooks/produtos/${token}/generico`,
  });

  const copyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
    } catch {
      setToast({ type: 'error', message: t('products.toasts.copyFailed') });
    }
  };

  const openCreate = () => setDraft(emptyDraft(sessions[0]?.id ?? ''));

  const openEdit = (product: Product) => {
    setDraft({
      id: product.id,
      name: product.name,
      sessionId: product.sessionId,
      active: product.active,
      steps: product.steps.map(s => ({
        type: s.type,
        delayMinutes: s.delayMinutes,
        text: s.text ?? '',
        mediaPath: s.mediaPath ?? undefined,
        mediaFilename: s.mediaFilename ?? undefined,
        mediaMimetype: s.mediaMimetype ?? undefined,
      })),
    });
  };

  const updateStep = (index: number, patch: Partial<StepDraft>) => {
    setDraft(prev =>
      prev ? { ...prev, steps: prev.steps.map((s, i) => (i === index ? { ...s, ...patch } : s)) } : prev,
    );
  };

  const addStep = () => {
    setDraft(prev =>
      prev ? { ...prev, steps: [...prev.steps, { type: 'text', delayMinutes: 60, text: '' }] } : prev,
    );
  };

  const removeStep = (index: number) => {
    setDraft(prev => (prev ? { ...prev, steps: prev.steps.filter((_, i) => i !== index) } : prev));
  };

  const moveStep = (index: number, dir: -1 | 1) => {
    setDraft(prev => {
      if (!prev) return prev;
      const target = index + dir;
      if (target < 0 || target >= prev.steps.length) return prev;
      const steps = [...prev.steps];
      [steps[index], steps[target]] = [steps[target], steps[index]];
      return { ...prev, steps };
    });
  };

  const handleUpload = async (index: number, file: File) => {
    setUploadingStep(index);
    try {
      const res = await uploadMutation.mutateAsync(file);
      updateStep(index, {
        mediaPath: res.mediaPath,
        mediaFilename: res.mediaFilename,
        mediaMimetype: res.mediaMimetype,
      });
    } catch (err) {
      setToast({
        type: 'error',
        message: t('products.toasts.uploadFailed', {
          message: err instanceof Error ? err.message : t('common.unknownError'),
        }),
      });
    } finally {
      setUploadingStep(null);
    }
  };

  const handleSave = async () => {
    if (!draft || !draft.name.trim() || !draft.sessionId) return;
    const steps: FunnelStepInput[] = draft.steps.map(s => ({
      type: s.type,
      delayMinutes: s.delayMinutes,
      text: s.text || undefined,
      mediaPath: s.type === 'text' ? undefined : s.mediaPath,
      mediaFilename: s.type === 'text' ? undefined : s.mediaFilename,
      mediaMimetype: s.type === 'text' ? undefined : s.mediaMimetype,
    }));
    try {
      if (draft.id) {
        await updateMutation.mutateAsync({
          id: draft.id,
          data: { name: draft.name.trim(), sessionId: draft.sessionId, active: draft.active, steps },
        });
        setToast({ type: 'success', message: t('products.toasts.updated') });
      } else {
        await createMutation.mutateAsync({
          name: draft.name.trim(),
          sessionId: draft.sessionId,
          active: draft.active,
          steps,
        });
        setToast({ type: 'success', message: t('products.toasts.created') });
      }
      setDraft(null);
    } catch (err) {
      setToast({
        type: 'error',
        message: t('products.toasts.saveFailed', {
          message: err instanceof Error ? err.message : t('common.unknownError'),
        }),
      });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync(deleteTarget.id);
      setDeleteTarget(null);
      setToast({ type: 'success', message: t('products.toasts.deleted') });
    } catch (err) {
      setToast({
        type: 'error',
        message: t('products.toasts.deleteFailed', {
          message: err instanceof Error ? err.message : t('common.unknownError'),
        }),
      });
    }
  };

  const handleTest = async () => {
    if (!testTarget || !testPhone.trim()) return;
    try {
      await testMutation.mutateAsync({ id: testTarget.id, phone: testPhone.trim() });
      setTestTarget(null);
      setTestPhone('');
      setToast({ type: 'success', message: t('products.toasts.testSent') });
    } catch (err) {
      setToast({
        type: 'error',
        message: t('products.toasts.testFailed', {
          message: err instanceof Error ? err.message : t('common.unknownError'),
        }),
      });
    }
  };

  if (isLoading) {
    return (
      <div
        className="products-page"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '400px' }}
      >
        <Loader2 className="animate-spin" size={32} />
      </div>
    );
  }

  return (
    <div className="products-page">
      {toast && (
        <div className={`toast ${toast.type}`}>
          {toast.type === 'success' ? <Check size={18} /> : <AlertTriangle size={18} />}
          <span>{toast.message}</span>
          <button className="toast-close" onClick={() => setToast(null)}>
            <X size={16} />
          </button>
        </div>
      )}

      <PageHeader
        title={t('products.title')}
        subtitle={t('products.subtitle')}
        actions={
          canWrite && (
            <button className="btn-primary" onClick={openCreate} disabled={sessions.length === 0}>
              <Plus size={18} />
              {t('products.addProduct')}
            </button>
          )
        }
      />

      {isError && (
        <div className="error-banner" role="alert">
          <AlertCircle size={20} />
          <span className="error-banner-text">{t('dashboard.loadError')}</span>
        </div>
      )}

      {sessions.length === 0 && !isError && (
        <div className="error-banner" role="alert">
          <AlertCircle size={20} />
          <span className="error-banner-text">{t('products.noSessions')}</span>
        </div>
      )}

      {products.length === 0 ? (
        <div className="empty-table-state">
          <Package size={48} strokeWidth={1} />
          <h3>{t('products.empty.title')}</h3>
          <p>{t('products.empty.description')}</p>
        </div>
      ) : (
        <div className="products-card-list">
          {products.map(product => {
            const urls = webhookUrls(product.webhookToken);
            return (
              <div key={product.id} className="product-card">
                <div className="product-card-header">
                  <div className="product-title-row">
                    <Package size={18} className="product-icon" />
                    <h3>{product.name}</h3>
                    <span className={`status-badge ${product.active ? 'active' : 'inactive'}`}>
                      {product.active ? t('common.active') : t('common.inactive')}
                    </span>
                  </div>
                  {canWrite && (
                    <div className="product-card-actions">
                      <button
                        className="icon-btn"
                        title={t('products.actions.test')}
                        onClick={() => {
                          setTestTarget(product);
                          setTestPhone('');
                        }}
                      >
                        <Send size={16} />
                      </button>
                      <button className="icon-btn" title={t('common.edit')} onClick={() => openEdit(product)}>
                        <Edit size={16} />
                      </button>
                      <button
                        className="icon-btn danger"
                        title={t('common.delete')}
                        onClick={() => setDeleteTarget(product)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  )}
                </div>

                <div className="product-meta">
                  <span className="product-meta-label">{t('products.session')}</span>
                  <span className="product-meta-value">{sessionName(product.sessionId)}</span>
                  <span className="product-meta-label">{t('products.stepsCount')}</span>
                  <span className="product-meta-value">{product.steps.length}</span>
                </div>

                <div className="product-webhooks">
                  <span className="product-meta-label">{t('products.webhookUrls')}</span>
                  {(['perfectpay', 'kirvano', 'generico'] as const).map(provider => (
                    <div key={provider} className="webhook-url-line">
                      <span className="webhook-provider">{t(`products.providers.${provider}`)}</span>
                      <code className="webhook-url">{urls[provider]}</code>
                      <button
                        className="icon-btn"
                        title={t('products.actions.copy')}
                        onClick={() => copyUrl(urls[provider])}
                      >
                        {copied === urls[provider] ? <Check size={14} /> : <Copy size={14} />}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {draft && (
        <div className="modal-overlay" onClick={() => setDraft(null)}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{draft.id ? t('products.editTitle') : t('products.createTitle')}</h2>
              <button className="btn-icon" onClick={() => setDraft(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <label>{t('products.name')}</label>
              <input
                type="text"
                placeholder={t('products.namePlaceholder')}
                value={draft.name}
                onChange={e => setDraft({ ...draft, name: e.target.value })}
              />

              <label>{t('products.session')}</label>
              <select value={draft.sessionId} onChange={e => setDraft({ ...draft, sessionId: e.target.value })}>
                <option value="">{t('products.selectSession')}</option>
                {sessions.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>

              <div className="toggle-group">
                <span className="toggle-label">{t('common.status')}</span>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={draft.active}
                    onChange={e => setDraft({ ...draft, active: e.target.checked })}
                  />
                  <span className="toggle-slider"></span>
                </label>
                <span className={`toggle-status ${draft.active ? 'active' : 'inactive'}`}>
                  {draft.active ? t('common.active') : t('common.inactive')}
                </span>
              </div>

              <div className="funnel-steps-header">
                <label>{t('products.funnelSteps')}</label>
                <span className="funnel-hint">{t('products.placeholderHint')}</span>
              </div>

              {draft.steps.map((step, index) => (
                <div key={index} className="funnel-step">
                  <div className="funnel-step-top">
                    <span className="funnel-step-number">
                      {stepIcon(step.type)} {t('products.stepN', { n: index + 1 })}
                    </span>
                    <div className="funnel-step-controls">
                      <button
                        className="icon-btn"
                        title={t('products.moveUp')}
                        disabled={index === 0}
                        onClick={() => moveStep(index, -1)}
                      >
                        <ChevronUp size={14} />
                      </button>
                      <button
                        className="icon-btn"
                        title={t('products.moveDown')}
                        disabled={index === draft.steps.length - 1}
                        onClick={() => moveStep(index, 1)}
                      >
                        <ChevronDown size={14} />
                      </button>
                      <button
                        className="icon-btn danger"
                        title={t('products.removeStep')}
                        disabled={draft.steps.length === 1}
                        onClick={() => removeStep(index)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  <div className="funnel-step-row">
                    <div className="funnel-step-field">
                      <label>{t('products.stepType')}</label>
                      <select
                        value={step.type}
                        onChange={e => updateStep(index, { type: e.target.value as FunnelStepType })}
                      >
                        {FUNNEL_STEP_TYPES.map(type => (
                          <option key={type} value={type}>
                            {t(`products.stepTypes.${type}`)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="funnel-step-field">
                      <label>{t('products.delayMinutes')}</label>
                      <input
                        type="number"
                        min={0}
                        max={43200}
                        value={step.delayMinutes}
                        onChange={e => updateStep(index, { delayMinutes: Number(e.target.value) })}
                      />
                    </div>
                  </div>

                  {step.type !== 'text' && (
                    <div className="funnel-step-media">
                      <label className="upload-btn">
                        {uploadingStep === index ? (
                          <Loader2 size={16} className="animate-spin" />
                        ) : (
                          <Upload size={16} />
                        )}
                        {step.mediaFilename ? t('products.replaceMedia') : t('products.uploadMedia')}
                        <input
                          type="file"
                          hidden
                          onChange={e => {
                            const file = e.target.files?.[0];
                            if (file) void handleUpload(index, file);
                            e.target.value = '';
                          }}
                        />
                      </label>
                      {step.mediaFilename && <span className="media-filename">{step.mediaFilename}</span>}
                    </div>
                  )}

                  <label>{step.type === 'text' ? t('products.stepText') : t('products.caption')}</label>
                  <textarea
                    rows={2}
                    placeholder={t('products.textPlaceholder')}
                    value={step.text}
                    onChange={e => updateStep(index, { text: e.target.value })}
                  />
                </div>
              ))}

              <button className="btn-secondary add-step-btn" onClick={addStep}>
                <Plus size={16} />
                {t('products.addStep')}
              </button>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setDraft(null)}>
                {t('common.cancel')}
              </button>
              <button
                className="btn-primary"
                onClick={handleSave}
                disabled={!draft.name.trim() || !draft.sessionId || createMutation.isPending || updateMutation.isPending}
              >
                {createMutation.isPending || updateMutation.isPending ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  t('common.save')
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {testTarget && (
        <div className="modal-overlay" onClick={() => setTestTarget(null)}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{t('products.testTitle')}</h2>
              <button className="btn-icon" onClick={() => setTestTarget(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <p>{t('products.testDescription', { name: testTarget.name })}</p>
              <label>{t('products.phone')}</label>
              <input
                type="tel"
                placeholder="5511999999999"
                value={testPhone}
                onChange={e => setTestPhone(e.target.value)}
              />
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setTestTarget(null)}>
                {t('common.cancel')}
              </button>
              <button
                className="btn-primary"
                onClick={handleTest}
                disabled={!testPhone.trim() || testMutation.isPending}
              >
                {testMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : t('products.sendTest')}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{t('products.deleteTitle')}</h2>
              <button className="btn-icon" onClick={() => setDeleteTarget(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <p>{t('products.deleteConfirm', { name: deleteTarget.name })}</p>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setDeleteTarget(null)}>
                {t('common.cancel')}
              </button>
              <button className="btn-danger" onClick={handleDelete} disabled={deleteMutation.isPending}>
                {deleteMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
