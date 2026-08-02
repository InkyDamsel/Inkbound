import { LibrarySanctuaryRepository } from '../data/librarySanctuaryRepository';
import {
  DEFAULT_LIBRARY_SANCTUARY,
  LibrarySanctuary,
  normalizeLibrarySanctuary,
} from '../model/librarySanctuary';

export type LibrarySanctuaryStatus = 'idle' | 'loading' | 'ready' | 'saving' | 'error';

export interface LibrarySanctuaryState {
  sanctuary: LibrarySanctuary;
  status: LibrarySanctuaryStatus;
  errorMessage: string | null;
}

type Listener = () => void;
type SanctuaryUpdater = (
  current: LibrarySanctuary,
) => Partial<LibrarySanctuary> | LibrarySanctuary;

export class LibrarySanctuaryController {
  private readonly listeners = new Set<Listener>();
  private saveChain: Promise<void> = Promise.resolve();

  private state: LibrarySanctuaryState = {
    sanctuary: DEFAULT_LIBRARY_SANCTUARY,
    status: 'idle',
    errorMessage: null,
  };

  constructor(private readonly repository: LibrarySanctuaryRepository) {}

  getSnapshot = (): LibrarySanctuaryState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async load(): Promise<void> {
    this.setState({ status: 'loading', errorMessage: null });

    try {
      const sanctuary = await this.repository.load();
      this.setState({
        sanctuary: normalizeLibrarySanctuary(sanctuary),
        status: 'ready',
        errorMessage: null,
      });
    } catch (error) {
      this.setState({
        status: 'error',
        errorMessage: this.describeError(error, 'Unable to open your sanctuary.'),
      });
    }
  }

  update(updater: SanctuaryUpdater): void {
    const changes = updater(this.state.sanctuary);
    const sanctuary = normalizeLibrarySanctuary({
      ...this.state.sanctuary,
      ...changes,
      updatedAt: new Date().toISOString(),
    });

    this.setState({
      sanctuary,
      status: 'saving',
      errorMessage: null,
    });

    this.queueSave(sanctuary);
  }

  async reset(): Promise<void> {
    this.setState({ status: 'saving', errorMessage: null });

    try {
      const sanctuary = await this.repository.reset();
      this.setState({
        sanctuary: normalizeLibrarySanctuary(sanctuary),
        status: 'ready',
        errorMessage: null,
      });
    } catch (error) {
      this.setState({
        status: 'error',
        errorMessage: this.describeError(error, 'Unable to reset your sanctuary.'),
      });
    }
  }

  clearError(): void {
    if (this.state.status !== 'error') return;
    this.setState({ status: 'ready', errorMessage: null });
  }

  private queueSave(sanctuary: LibrarySanctuary): void {
    this.saveChain = this.saveChain
      .catch(() => undefined)
      .then(async () => {
        try {
          const saved = await this.repository.save(sanctuary);

          if (this.state.sanctuary.updatedAt === sanctuary.updatedAt) {
            this.setState({
              sanctuary: normalizeLibrarySanctuary(saved),
              status: 'ready',
              errorMessage: null,
            });
          }
        } catch (error) {
          if (this.state.sanctuary.updatedAt === sanctuary.updatedAt) {
            this.setState({
              status: 'error',
              errorMessage: this.describeError(
                error,
                'Your sanctuary changes could not be saved.',
              ),
            });
          }
        }
      });
  }

  private setState(changes: Partial<LibrarySanctuaryState>): void {
    this.state = { ...this.state, ...changes };
    this.listeners.forEach((listener) => listener());
  }

  private describeError(error: unknown, fallback: string): string {
    return error instanceof Error && error.message.trim().length > 0
      ? error.message
      : fallback;
  }
}
