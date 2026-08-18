export type PickedFile = { name: string; path: string };

export function pathFromBrowserFile(file: File): string {
  const withPath = file as File & { path?: string };
  return withPath.path?.trim() || file.name;
}

export function pickedFilesFromList(list: FileList | null | undefined): PickedFile[] {
  if (!list) return [];
  return Array.from(list).map((file) => ({
    name: file.name,
    path: pathFromBrowserFile(file),
  }));
}
