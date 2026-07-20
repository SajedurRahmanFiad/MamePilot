import React, { useState, useEffect } from 'react';
import { Button, LoadingOverlay } from '../components';
import { useAuth } from '../src/contexts/AuthProvider';
import { useToastNotifications } from '../src/contexts/ToastContext';
import { useQueryClient } from '@tanstack/react-query';
import { useDeveloperNotes } from '../src/hooks/useQueries';
import { useUpdateDeveloperNotes } from '../src/hooks/useMutations';
import { theme } from '../theme';

const DeveloperNotes: React.FC = () => {
  const { user } = useAuth();
  const toast = useToastNotifications();
  const queryClient = useQueryClient();
  const { data: notesData, isPending: loadingNotes } = useDeveloperNotes(user?.role === 'Developer');
  const updateNotesMutation = useUpdateDeveloperNotes();
  const [content, setContent] = useState('');

  useEffect(() => {
    if (notesData?.content !== undefined) {
      setContent(notesData.content);
    }
  }, [notesData]);

  const handleSave = async () => {
    try {
      await updateNotesMutation.mutateAsync({ content });
      toast.success('Notes saved successfully.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save notes.');
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <LoadingOverlay isLoading={loadingNotes} message="Loading notes..." />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-gray-900">Developer Notes</h1>
          <p className="mt-1 text-sm text-gray-500">Private notes visible only to developers.</p>
        </div>
        <Button
          onClick={handleSave}
          loading={updateNotesMutation.isPending}
        >
          Save Notes
        </Button>
      </div>
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-1">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Type your developer notes here..."
          className="w-full min-h-[500px] p-4 text-sm font-mono text-gray-900 bg-transparent border-0 outline-none resize-y"
          spellCheck={false}
        />
      </div>
    </div>
  );
};

export default DeveloperNotes;
