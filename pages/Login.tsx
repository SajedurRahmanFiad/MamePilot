import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../src/contexts/AuthProvider';
import { useAppBranding } from '../src/contexts/BrandingProvider';

const Login: React.FC = () => {
  const navigate = useNavigate();
  const { signIn, isLoading, user } = useAuth();
  const branding = useAppBranding();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const brandLoading = branding.mode === 'loading';
  const brandUnavailable = branding.mode === 'unavailable';

  // Redirect to dashboard when user is fully authenticated
  // Profile is now GUARANTEED to exist when user exists (never null)
  useEffect(() => {
    console.log('[Login] Checking redirect - isLoading:', isLoading, 'authenticated:', !!user);
    if (!isLoading && user) {
      console.log('[Login] User authenticated, navigating to dashboard');
      navigate('/dashboard', { replace: true });
    }
  }, [user, isLoading, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);
    const normalizedPhone = phone.trim();
    console.log('[Login] Form submitted with phone:', normalizedPhone);

    try {
      console.log('[Login] Calling signIn...');
      const { error: signInError, data } = await signIn(normalizedPhone, password);

      if (signInError) {
        console.error('[Login] Sign-in error:', signInError);
        const errorMsg = signInError?.message || 'Authentication failed';
        setError(errorMsg);
        setIsSubmitting(false);
        return;
      }

      console.log('[Login] Sign-in successful for user:', data?.user?.phone || normalizedPhone);
      setIsSubmitting(false);
      navigate('/dashboard', { replace: true });
    } catch (err: any) {
      console.error('[Login] Sign-in exception:', err);
      setError(err?.message || 'Failed to sign in');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow p-8">
        <div className="flex items-center gap-4 mb-6">
          {brandLoading || brandUnavailable ? (
            <div
              className={`h-12 w-12 rounded-md bg-gray-100 ${brandLoading ? 'animate-pulse' : ''}`}
              role="status"
              aria-label={brandLoading ? 'Loading workspace branding' : 'Workspace branding unavailable'}
            />
          ) : (
            branding.compactLogo && (
              <img
                src={branding.compactLogo}
                alt={branding.name || 'Company logo'}
                className="w-12 h-12 rounded-md object-cover"
                onError={(e) => {
                  if (branding.mode === 'mamepilot') {
                    e.currentTarget.src = '/uploads/Avatar.png';
                  } else {
                    e.currentTarget.style.visibility = 'hidden';
                  }
                }}
              />
            )
          )}
          <div>
            {brandLoading ? (
              <div className="h-6 w-36 animate-pulse rounded bg-gray-100" />
            ) : (
              <h1 className="text-xl font-bold">{branding.name || 'Management'}</h1>
            )}
            <p className="text-sm text-gray-500">Sign in to continue</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Phone</label>
            <input
              value={phone}
              onChange={e => setPhone(e.target.value)}
              type="tel"
              placeholder="017XXXXXXXX"
              required
              disabled={isSubmitting}
              className="mt-1 block w-full border rounded px-3 py-2 focus:outline-none focus:ring disabled:opacity-50"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Password</label>
            <div className="relative">
              <input
                value={password}
                onChange={e => setPassword(e.target.value)}
                type={showPassword ? 'text' : 'password'}
                required
                disabled={isSubmitting}
                className="mt-1 block w-full border rounded px-3 py-2 pr-10 focus:outline-none focus:ring disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                disabled={isSubmitting}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700 disabled:opacity-50"
              >
                {showPassword ? (
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z"></path><path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd"></path></svg>
                ) : (
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-14-14zM10 4C6.687 4 3.89 5.945 2.58 8.808c-.35.915-.35 2.468 0 3.384.74 1.94 2.08 3.61 3.756 4.7l1.83-1.83A3.992 3.992 0 016 10a4 4 0 016.956-3.533l1.416-1.416C14.225 4.523 12.15 4 10 4zm7.42 3.192c.35.915.35 2.468 0 3.384C15.26 13.055 12.463 15 9 15a6.966 6.966 0 01-3.15-.744l2.119-2.119A3.992 3.992 0 0114 10c0-.901-.281-1.735-.743-2.434l2.163-2.174z" clipRule="evenodd"></path></svg>
                )}
              </button>
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-600">
              <p className="font-semibold">Error</p>
              <p>{error}</p>
            </div>
          )}

          <div>
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-blue-600 text-white py-2 rounded disabled:opacity-50 disabled:cursor-not-allowed font-medium hover:bg-blue-700 transition-colors"
            >
              {isSubmitting ? 'Signing in...' : 'Sign In'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default Login;
