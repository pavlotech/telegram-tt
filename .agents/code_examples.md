# Примеры кода и Стилевые правила

Здесь описаны примеры реализации кода, соответствующие нашим стандартам frontend-разработки.

## React и TypeScript

### Основные правила

1.  **Функциональные компоненты**: Используйте функциональные компоненты и хуки (устаревшие классовые компоненты не применяются).
2.  **Переменные**: Используйте `const` по умолчанию. Если значение будет переопределяться (например, внутри циклов или условий), смело используйте `let`.
3.  **Импорты**: Поддерживайте логический порядок импортов.

### Пример модульного компонента

```tsx
import React, { useState, useEffect, useCallback } from "react";
import styles from "./MyComponent.module.scss";
import { someApiCall } from "../../api";

interface MyComponentProps {
  userId: string;
  onLoadComplete?: () => void;
}

export const MyComponent: React.FC<MyComponentProps> = ({
  userId,
  onLoadComplete,
}) => {
  // Использование let допустимо, если требуется
  let defaultStatus = "idle";

  const [status, setStatus] = useState<string>(defaultStatus);
  const [data, setData] = useState<any>(null);

  const loadData = useCallback(async () => {
    setStatus("loading");
    try {
      const result = await someApiCall(userId);
      setData(result);
      setStatus("success");
      onLoadComplete?.();
    } catch (err) {
      setStatus("error");
    }
  }, [userId, onLoadComplete]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (status === "loading") {
    return <div className={styles.loader}>Загрузка...</div>;
  }

  if (status === "error") {
    return <div className={styles.error}>Произошла ошибка</div>;
  }

  return (
    <div className={styles.container}>
      <h1>Данные пользователя</h1>
      {data && <p>{data.name}</p>}
    </div>
  );
};
```
