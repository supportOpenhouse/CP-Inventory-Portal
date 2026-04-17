import { useRef, useState } from 'react';

import {
  MAX_PHOTOS,
  previewUrl,
  uploadToCloudinary,
  validateFile,
} from '../../cloudinary';

/**
 * Step 3: Photos. Uploads directly to Cloudinary.
 * Max 5 photos per unit. All fields still optional — CP can skip.
 */
export default function Step3({ form, setForm, onNext, onBack }) {
  const photos = form.photos || [];
  const inputRef = useRef(null);

  // Active uploads — keyed by a client-side temp id so we can track progress
  const [active, setActive] = useState([]); // [{ tempId, name, progress, error }]

  const remainingSlots = MAX_PHOTOS - photos.length - active.filter((a) => !a.error).length;

  const addPhoto = (publicId) => {
    setForm((f) => ({ ...f, photos: [...(f.photos || []), publicId] }));
  };

  const removePhoto = (publicId) => {
    setForm((f) => ({ ...f, photos: (f.photos || []).filter((p) => p !== publicId) }));
  };

  const updateActive = (tempId, changes) => {
    setActive((list) => list.map((a) => (a.tempId === tempId ? { ...a, ...changes } : a)));
  };

  const removeActive = (tempId) => {
    setActive((list) => list.filter((a) => a.tempId !== tempId));
  };

  const handleFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;

    // Truncate to what fits
    const toUpload = files.slice(0, remainingSlots);

    for (const file of toUpload) {
      const tempId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const validationError = validateFile(file);
      if (validationError) {
        setActive((list) => [
          ...list,
          { tempId, name: file.name, progress: 0, error: validationError },
        ]);
        // Auto-dismiss after 4 seconds
        setTimeout(() => removeActive(tempId), 4000);
        continue;
      }

      setActive((list) => [...list, { tempId, name: file.name, progress: 0, error: null }]);

      try {
        const result = await uploadToCloudinary(file, (pct) => {
          updateActive(tempId, { progress: pct });
        });
        addPhoto(result.publicId);
        removeActive(tempId);
      } catch (err) {
        updateActive(tempId, { error: err.message || 'Upload failed', progress: 0 });
        setTimeout(() => removeActive(tempId), 4000);
      }
    }
  };

  const onInputChange = (e) => {
    handleFiles(e.target.files);
    // Reset so same file can be picked again if removed
    e.target.value = '';
  };

  const onDrop = (e) => {
    e.preventDefault();
    handleFiles(e.dataTransfer.files);
  };

  const onDragOver = (e) => {
    e.preventDefault();
  };

  return (
    <div className="form-section">
      <div className="form-card">
        <div className="form-card-title">
          Photos — optional ({photos.length}/{MAX_PHOTOS})
        </div>

        {/* Upload drop zone */}
        {remainingSlots > 0 && (
          <div
            onClick={() => inputRef.current?.click()}
            onDrop={onDrop}
            onDragOver={onDragOver}
            style={{
              border: '2px dashed var(--oh-border)',
              borderRadius: 12,
              padding: '28px 16px',
              textAlign: 'center',
              cursor: 'pointer',
              background: 'var(--oh-bg-warm)',
              transition: 'border-color 0.15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--oh-orange)')}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--oh-border)')}
          >
            <div style={{ fontSize: 32, marginBottom: 8 }}>📷</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--oh-charcoal)' }}>
              Tap to add photos
            </div>
            <div style={{ fontSize: 12, color: 'var(--oh-gray)', marginTop: 4 }}>
              or drag and drop · JPG, PNG, WebP · max 5 MB each · {remainingSlots} remaining
            </div>
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          onChange={onInputChange}
          style={{ display: 'none' }}
        />

        {/* Active uploads list */}
        {active.length > 0 && (
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {active.map((a) => (
              <div
                key={a.tempId}
                style={{
                  padding: 10,
                  background: a.error ? '#FFF5F5' : 'var(--oh-bg-warm)',
                  border: `1px solid ${a.error ? 'var(--oh-red)' : 'var(--oh-border)'}`,
                  borderRadius: 8,
                  fontSize: 13,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--oh-charcoal)', fontWeight: 500 }}>
                    {a.name.length > 30 ? a.name.slice(0, 27) + '…' : a.name}
                  </span>
                  <span style={{ color: a.error ? 'var(--oh-red)' : 'var(--oh-gray)' }}>
                    {a.error ? 'Failed' : `${a.progress}%`}
                  </span>
                </div>
                {a.error ? (
                  <div style={{ color: 'var(--oh-red)', fontSize: 12, marginTop: 4 }}>
                    {a.error}
                  </div>
                ) : (
                  <div
                    style={{
                      height: 4,
                      background: 'var(--oh-border)',
                      borderRadius: 2,
                      marginTop: 6,
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${a.progress}%`,
                        background: 'var(--oh-orange)',
                        transition: 'width 0.2s',
                      }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Uploaded photos grid */}
        {photos.length > 0 && (
          <div
            style={{
              marginTop: 16,
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
              gap: 10,
            }}
          >
            {photos.map((publicId) => (
              <div
                key={publicId}
                style={{
                  position: 'relative',
                  borderRadius: 10,
                  overflow: 'hidden',
                  aspectRatio: '4/3',
                  background: 'var(--oh-bg-warm)',
                  border: '1px solid var(--oh-border)',
                }}
              >
                <img
                  src={previewUrl(publicId)}
                  alt="Unit"
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
                <button
                  onClick={() => removePhoto(publicId)}
                  aria-label="Remove photo"
                  style={{
                    position: 'absolute',
                    top: 6,
                    right: 6,
                    width: 26,
                    height: 26,
                    borderRadius: '50%',
                    background: 'rgba(0,0,0,0.6)',
                    color: '#fff',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: 14,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="optional-hint">
          Photos help the evaluation team move faster. You can still share on WhatsApp with your RM if you prefer.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
        <button className="secondary-btn" onClick={onBack}>Back</button>
        <button className="primary-btn" onClick={onNext}>
          {photos.length === 0 ? 'Skip & Continue' : 'Continue'}
        </button>
      </div>
    </div>
  );
}