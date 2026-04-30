import { AppView } from './AppView';
import { useAppController } from './useAppController';

function App() {
    const controller = useAppController();
    return <AppView controller={controller} />;
}

export default App;
