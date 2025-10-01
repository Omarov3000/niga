test
nice to have:
1. Structural Sharing. Ensures referential equality for unchanged parts of data.
2. notifyOnChangeProps to avoid unnecessary re-renders when re-fetching in background. React Query automatically tracks which fields you access during render, and only re-renders when those change `notifyOnChangeProps: 'tracked'`.
