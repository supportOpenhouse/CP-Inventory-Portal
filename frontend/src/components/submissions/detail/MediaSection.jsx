/**
 * Attachments + Uploaded media — CP-shared and staff-uploaded photos/videos.
 * Ported from CP DetailPanel.jsx ("Attachments" + "Uploaded media" blocks +
 * handlePhotoUpload/handleRemovePhoto). Upload/remove goes through
 * Cloudinary (uploadToCloudinary) and then persists the public_id list via
 * adminUpdateSubmission. Add/remove is staff-only (`canAct`); viewers get a
 * read-only grid. Clicking any thumbnail opens a full-size lightbox.
 */
import { useRef, useState } from 'react';
import { api } from '../../../api';
import {
  uploadToCloudinary, validateFile, thumbnailUrl, previewUrl, MAX_PHOTOS,
} from '../../../cloudinary';

// `only`: 'attachments' | 'media' — render just that block (the table-view
// columns show them as separate columns). Default renders both.
export default function MediaSection({ submission, canAct, onChanged, only }) {
  const [busy, setBusy] = useState(false);
  const [uploadingPct, setUploadingPct] = useState(null);
  const [lightboxId, setLightboxId] = useState(null);
  const fileInputRef = useRef(null);

  if (!submission) return null;
  const s = submission;

  const refreshAndBubble = async () => {
    const fresh = await api.adminGetSubmission(s.id);
    onChanged?.({ ...fresh.submission, events: fresh.events });
  };

  const handlePhotoUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const currentPhotos = Array.isArray(s.photos) ? s.photos : [];
    if (currentPhotos.length + files.length > MAX_PHOTOS) {
      alert(`Max ${MAX_PHOTOS} photos per submission. Already has ${currentPhotos.length}.`);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    const newIds = [];
    for (const file of files) {
      const err = validateFile(file);
      if (err) { alert(err); continue; }
      try {
        setUploadingPct(0);
        const { publicId } = await uploadToCloudinary(file, setUploadingPct);
        newIds.push(publicId);
      } catch (uploadErr) {
        alert(`Upload failed: ${uploadErr.message}`);
      }
    }
    setUploadingPct(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (newIds.length) {
      try {
        await api.adminUpdateSubmission(s.id, { photos: [...currentPhotos, ...newIds] });
        await refreshAndBubble();
      } catch (err) {
        alert(err.message || 'Failed to save photos');
      }
    }
  };

  const handleRemovePhoto = async (publicId) => {
    if (busy) return;
    if (!confirm('Remove this photo from the submission?')) return;
    const current = Array.isArray(s.photos) ? s.photos : [];
    const remaining = current.filter((p) => p !== publicId);
    setBusy(true);
    try {
      await api.adminUpdateSubmission(s.id, { photos: remaining });
      await refreshAndBubble();
    } catch (err) {
      alert(err.message || 'Failed to remove');
    } finally {
      setBusy(false);
    }
  };

  const hasMedia = (Array.isArray(s.photos) && s.photos.length > 0) || (Array.isArray(s.videos) && s.videos.length > 0);

  return (
    <>
      {only !== 'media' && (
      <div className="card-block">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ marginBottom: 0 }}>Attachments</h3>
          {canAct && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                style={{ display: 'none' }}
                onChange={handlePhotoUpload}
              />
              <button
                type="button"
                className="btn-soft"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy || uploadingPct !== null}
              >
                {uploadingPct !== null ? `Uploading ${uploadingPct}%` : '＋ Photos'}
              </button>
            </>
          )}
        </div>

        {Array.isArray(s.photos) && s.photos.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {s.photos.map((pid) => (
              <div key={pid} style={{ position: 'relative', width: 90, height: 90 }}>
                <img
                  src={thumbnailUrl(pid, 120)}
                  alt=""
                  onClick={() => setLightboxId(pid)}
                  style={{ width: '100%', height: '100%', borderRadius: 'var(--r-sm)', objectFit: 'cover', cursor: 'pointer', border: '1px solid var(--border)' }}
                />
                {canAct && (
                  <button
                    type="button"
                    onClick={() => handleRemovePhoto(pid)}
                    title="Remove photo"
                    style={{
                      position: 'absolute', top: -6, right: -6, width: 20, height: 20,
                      borderRadius: '999px', border: 'none', background: 'var(--red)', color: '#fff',
                      fontSize: 11, lineHeight: '20px', padding: 0, cursor: 'pointer',
                    }}
                  >✕</button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="muted" style={{ fontSize: 13 }}>No photos.</div>
        )}

        {s.drive_links && (
          <div style={{ marginTop: 12 }}>
            <div className="field-lbl">Google Drive URLs</div>
            <div style={{ fontSize: 12 }}>
              {s.drive_links.split(/[,\n]/).map((url) => url.trim()).filter(Boolean).map((url, i) => (
                <div key={i} style={{ marginTop: 2 }}>
                  <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--brand-strong)' }}>
                    {url.length > 60 ? url.slice(0, 60) + '…' : url}
                  </a>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      )}

      {only !== 'attachments' && (
      <div className="card-block">
        <h3>Uploaded media</h3>
        {hasMedia ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {(s.photos || []).map((pid) => (
              <img
                key={pid} src={thumbnailUrl(pid, 90)} alt=""
                onClick={() => setLightboxId(pid)}
                style={{ width: 80, height: 80, borderRadius: 'var(--r-sm)', objectFit: 'cover', cursor: 'pointer', border: '1px solid var(--border)' }}
              />
            ))}
            {(s.videos || []).map((v, i) => (
              <video
                key={v.public_id || i} src={v.url} controls preload="metadata"
                style={{ width: 140, height: 90, borderRadius: 'var(--r-sm)', background: '#000', objectFit: 'cover' }}
              />
            ))}
          </div>
        ) : (
          <div className="muted" style={{ fontSize: 13 }}>No media uploaded.</div>
        )}
      </div>
      )}

      {lightboxId && (
        <div className="modal-backdrop" onClick={() => setLightboxId(null)}>
          <img
            src={previewUrl(lightboxId)}
            alt=""
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '90vw', maxHeight: '85vh', borderRadius: 'var(--r)', boxShadow: 'var(--shadow-lg)' }}
          />
          <button
            type="button"
            className="modal-close"
            onClick={() => setLightboxId(null)}
            style={{ position: 'fixed', top: 24, right: 28, fontSize: 30, color: '#fff' }}
          >✕</button>
        </div>
      )}
    </>
  );
}
