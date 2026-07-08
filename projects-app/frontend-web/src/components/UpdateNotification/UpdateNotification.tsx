import { useState } from 'react';
import { X, Download, CheckCircle, AlertCircle, RefreshCw } from 'lucide-react';
import { useUpdateStore } from '../../store/updateStore';

export function UpdateNotification() {
  const {
    isUpdateAvailable,
    updateInfo,
    isDownloading,
    downloadProgress,
    isUpdateDownloaded,
    error,
  } = useUpdateStore();
  
  const [dismissed, setDismissed] = useState(false);

  // Don't show if dismissed or no update
  if (dismissed || (!isUpdateAvailable && !isUpdateDownloaded && !error)) {
    return null;
  }

  const handleDownload = async () => {
    if (!window.electron) return;
    
    try {
      const result = await window.electron.downloadUpdate();
      if (result.error) {
        console.error('Failed to download update:', result.error);
      }
    } catch (err) {
      console.error('Error downloading update:', err);
    }
  };

  const handleInstall = async () => {
    if (!window.electron) return;
    
    try {
      await window.electron.installUpdate();
    } catch (err) {
      console.error('Error installing update:', err);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  return (
    <div className="fixed top-4 right-4 z-50 w-96 animate-in slide-in-from-top-5">
      <div className="bg-white rounded-lg shadow-xl border border-gray-200 overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between p-4 bg-gradient-to-r from-blue-500 to-blue-600">
          <div className="flex items-center gap-3">
            {isUpdateDownloaded ? (
              <CheckCircle className="h-6 w-6 text-white" />
            ) : error ? (
              <AlertCircle className="h-6 w-6 text-white" />
            ) : (
              <RefreshCw className={`h-6 w-6 text-white ${isDownloading ? 'animate-spin' : ''}`} />
            )}
            <div>
              <h3 className="text-lg font-semibold text-white">
                {isUpdateDownloaded
                  ? 'تحديث جاهز للتثبيت'
                  : error
                  ? 'خطأ في التحديث'
                  : isDownloading
                  ? 'جاري تحميل التحديث...'
                  : 'تحديث متاح'}
              </h3>
              {updateInfo && (
                <p className="text-sm text-blue-100">
                  النسخة {updateInfo.version}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={() => setDismissed(true)}
            className="text-white hover:text-gray-200 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          {error ? (
            <div className="text-sm text-red-600">
              <p className="font-medium">حدث خطأ أثناء التحديث:</p>
              <p className="mt-1 text-xs">{error}</p>
            </div>
          ) : isUpdateDownloaded ? (
            <div>
              <p className="text-sm text-gray-700 mb-4">
                تم تحميل التحديث بنجاح. أعد تشغيل التطبيق الآن لتثبيت التحديث الجديد.
              </p>
              <button
                onClick={handleInstall}
                className="w-full bg-green-500 hover:bg-green-600 text-white font-medium py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                <RefreshCw className="h-4 w-4" />
                إعادة التشغيل والتثبيت
              </button>
            </div>
          ) : isDownloading && downloadProgress ? (
            <div>
              <div className="mb-2 flex justify-between text-sm text-gray-600">
                <span>جاري التحميل...</span>
                <span>{downloadProgress.percent}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2 mb-2 overflow-hidden">
                <div
                  className="bg-blue-500 h-full transition-all duration-300 ease-out"
                  style={{ width: `${downloadProgress.percent}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-gray-500">
                <span>{formatBytes(downloadProgress.transferred)} / {formatBytes(downloadProgress.total)}</span>
                <span>{formatBytes(downloadProgress.bytesPerSecond)}/s</span>
              </div>
            </div>
          ) : (
            <div>
              {updateInfo?.releaseNotes && (
                <div className="mb-4 text-sm text-gray-700 max-h-32 overflow-y-auto">
                  <p className="font-medium mb-1">ما الجديد:</p>
                  <div className="text-xs whitespace-pre-wrap">{updateInfo.releaseNotes}</div>
                </div>
              )}
              <button
                onClick={handleDownload}
                className="w-full bg-blue-500 hover:bg-blue-600 text-white font-medium py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                <Download className="h-4 w-4" />
                تحميل التحديث
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        {!error && !isUpdateDownloaded && (
          <div className="px-4 py-3 bg-gray-50 border-t border-gray-100">
            <p className="text-xs text-gray-500 text-center">
              يمكنك الاستمرار في استخدام التطبيق أثناء التحميل
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
