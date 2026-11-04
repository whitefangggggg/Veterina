import { useEffect, useRef, useState } from 'react'
import { petPhotoRequest, validatePetPhoto } from '../lib/petPhotos'
import { usePetPhoto } from '../lib/usePetPhoto'

export default function PetPhotoField({ pet, value, onChange, disabled = false }) {
  const currentPhoto = usePetPhoto(pet)
  const [preview, setPreview] = useState(null)
  const [enabled, setEnabled] = useState(false)
  const [error, setError] = useState('')
  const [camera, setCamera] = useState(false)
  const [starting, setStarting] = useState(false)
  const video = useRef(null), stream = useRef(null), generation = useRef(0)
  const stop = () => { generation.current++; stream.current?.getTracks().forEach((track) => track.stop()); stream.current = null; setCamera(false); setStarting(false) }
  useEffect(() => {
    let active = true
    petPhotoRequest({ action: 'capabilities' }).then((result) => { if (active) setEnabled(result.enabled) }).catch(() => {})
    // These refs intentionally track the latest permission request and stream,
    // including a camera opened after this effect's initial render.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    return () => { active = false; generation.current++; stream.current?.getTracks().forEach((track) => track.stop()) }
  }, [])
  useEffect(() => {
    if (!value.file) { setPreview(null); return }
    const url = URL.createObjectURL(value.file); setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [value.file])
  const choose = async (file) => {
    setError('')
    try {
      await validatePetPhoto(file)
      if (typeof createImageBitmap === 'function') { const image = await createImageBitmap(file); image.close() }
      onChange({ file, remove: false, requestId: crypto.randomUUID() })
    } catch (failure) { setError(failure.message.includes('MB') || failure.message.includes('Choose') ? failure.message : 'This image could not be opened. Choose another JPEG, PNG or WebP photo.') }
  }
  const start = async () => {
    setError('')
    if (!navigator.mediaDevices?.getUserMedia) { setError('Camera capture is unavailable here. Use Upload photo, or open this app over HTTPS.'); return }
    setCamera(true); setStarting(true)
    const attempt = ++generation.current
    try {
      const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      if (generation.current !== attempt) { media.getTracks().forEach((track) => track.stop()); return }
      stream.current = media
      if (video.current) { video.current.srcObject = media; await video.current.play() }
      setStarting(false)
    } catch { stop(); setError('Camera access was denied or no camera is available. You can still upload a photo.') }
  }
  const capture = async () => {
    if (!video.current?.videoWidth) { setError('Wait for the camera preview before taking a photo.'); return }
    const canvas = document.createElement('canvas')
    const ratio = Math.min(1, 1600 / Math.max(video.current.videoWidth, video.current.videoHeight))
    canvas.width = Math.round(video.current.videoWidth * ratio); canvas.height = Math.round(video.current.videoHeight * ratio)
    canvas.getContext('2d').drawImage(video.current, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9))
    stop()
    if (blob) await choose(new File([blob], 'pet-photo.jpg', { type: 'image/jpeg' }))
  }
  const image = value.remove ? null : preview || currentPhoto
  return <div className="pet-photo-field field-span" role="group" aria-label="Pet profile photo">
    <strong>Profile photo <small>(optional, up to 5 MB)</small></strong>
    {image && <img className="pet-photo-preview" src={image} alt="Pet photo preview" />}
    {camera && <div className="pet-camera"><video ref={video} muted playsInline aria-label="Camera preview" /><button type="button" className="button button-primary" disabled={starting} onClick={capture}>{starting ? 'Starting camera…' : 'Take photo'}</button><button type="button" className="button button-secondary" onClick={stop}>Cancel camera</button></div>}
    <div className="record-actions">
      <label className="button button-secondary">{image ? 'Replace photo' : 'Upload photo'}<input aria-label="Upload pet photo" type="file" accept="image/jpeg,image/png,image/webp" disabled={!enabled || disabled} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void choose(file) }} /></label>
      <button type="button" className="button button-secondary" disabled={!enabled || disabled || camera} onClick={start}>{preview ? 'Retake photo' : 'Capture photo'}</button>
      {(image || value.file) && <button type="button" className="text-link danger-text" disabled={disabled} onClick={() => { stop(); setError(''); onChange({ file: null, remove: Boolean(pet?.has_photo), requestId: crypto.randomUUID() }) }}>Remove photo</button>}
    </div>
    {!enabled && <small>Photo uploads are temporarily unavailable. You can register the patient without a photo.</small>}
    {error && <p className="auth-message auth-error" role="alert">{error}</p>}
  </div>
}
